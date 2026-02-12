import { GoogleGenAI } from '@google/genai'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import Book from '#models/book'
import BookTracking from '#models/book_tracking'
import type { FetchResult } from '#services/mal_import_service'

const LOG_TAG = '[MangacollecImport]'

const MANGACOLLEC_BASE_URL = 'https://www.mangacollec.com'

const AI_CONCURRENCY = 2
const AI_RETRY_ATTEMPTS = 3
const AI_RETRY_BASE_DELAY_MS = 2000
const AI_CHUNK_DELAY_MS = 1500

type DataStoreSeries = {
  id: string
  title: string | null
  adult_content?: boolean
}

type DataStoreEdition = {
  id: string
  title: string | null
  series_id: string
  publisher_id: string | null
  volumes_count: number | null
}

type PublicCollectionEntry = {
  id: string
  edition_id: string
  user_id: string
  following: boolean
}

type DataStore = {
  series?: { data?: Record<string, DataStoreSeries> }
  editions?: {
    data?: Record<string, DataStoreEdition>
  }
  publicCollection?: Record<string, Array<Array<PublicCollectionEntry[]>>>
}

type SeriesCandidate = {
  seriesId: string
  title: string
}

type TitleTranslation = {
  french: string
  english: string | null
  japanese: string | null
  romaji: string | null
  nsfw: boolean
}

const MANGACOLLEC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class MangacollecImportService {
  private userId: string
  private cachedBooks: Book[] | null = null

  constructor(userId: string) {
    this.userId = userId
  }

  async fetchFromUsername(input: string): Promise<FetchResult> {
    const result: FetchResult = {
      pendingBooks: [],
      notFound: 0,
      skipped: 0,
      alreadyExists: 0,
      errors: [],
      details: {
        notFound: [],
        skipped: [],
        alreadyExists: [],
      },
    }

    const username = this.extractUsername(input)
    if (!username) {
      result.errors.push('Invalid Mangacollec username.')
      return result
    }

    try {
      logger.debug(`${LOG_TAG} Fetching collection for username="${username}"`)
      const html = await this.fetchCollectionHtml(username)
      const dataStore = this.extractDataStore(html)
      const candidates = this.buildSeriesCandidates(dataStore, username)

      logger.debug(`${LOG_TAG} Found ${candidates.length} series candidates from collection`)

      if (candidates.length === 0) {
        result.errors.push('No series found in this Mangacollec collection.')
        return result
      }

      // Load all non-NSFW books once for matching
      await this.loadBooks()
      logger.debug(`${LOG_TAG} Loaded ${this.cachedBooks?.length ?? 0} books from DB for matching`)

      // First pass: direct title matching
      const unmatchedCandidates: SeriesCandidate[] = []

      for (const candidate of candidates) {
        const book = this.matchCandidateToBook(candidate.title)
        if (book) {
          logger.debug(
            `${LOG_TAG} [Pass 1] MATCHED "${candidate.title}" → "${book.title}" (id=${book.id})`
          )
          await this.addBookToResult(book, candidate, result)
        } else {
          logger.debug(`${LOG_TAG} [Pass 1] NO MATCH for "${candidate.title}"`)
          unmatchedCandidates.push(candidate)
        }
      }

      logger.debug(
        `${LOG_TAG} Pass 1 complete: ${candidates.length - unmatchedCandidates.length} matched, ${unmatchedCandidates.length} unmatched`
      )

      // Pass 2: use Gemini AI with Google Search to resolve unmatched French titles
      if (unmatchedCandidates.length > 0) {
        logger.debug(
          `${LOG_TAG} [Pass 2] Sending ${unmatchedCandidates.length} unmatched titles to Gemini AI`
        )
        const translations = await this.resolveWithAi(unmatchedCandidates.map((c) => c.title))
        logger.debug(`${LOG_TAG} [Pass 2] Gemini returned ${translations.size} translations`)

        for (const candidate of unmatchedCandidates) {
          const translation = translations.get(candidate.title)
          let book: Book | null = null

          if (translation) {
            // Skip NSFW entries flagged by Gemini
            if (translation.nsfw) {
              logger.debug(
                `${LOG_TAG} [Pass 2] SKIPPED "${candidate.title}" — flagged NSFW by Gemini`
              )
              result.skipped++
              result.details.skipped.push(`${candidate.title} (NSFW)`)
              continue
            }

            // Try matching with each translated title variant
            const titleVariants = [
              translation.romaji,
              translation.english,
              translation.japanese,
            ].filter((t): t is string => !!t)

            logger.debug(
              `${LOG_TAG} [Pass 2] "${candidate.title}" → Gemini: en="${translation.english}", jp="${translation.japanese}", romaji="${translation.romaji}"`
            )

            for (const variant of titleVariants) {
              book = this.matchCandidateToBook(variant)
              if (book) {
                logger.debug(
                  `${LOG_TAG} [Pass 2] MATCHED "${candidate.title}" via variant "${variant}" → "${book.title}" (id=${book.id})`
                )
                break
              }
            }

            if (!book) {
              logger.debug(
                `${LOG_TAG} [Pass 2] NO MATCH for "${candidate.title}" even with variants [${titleVariants.join(', ')}]`
              )
            }
          } else {
            logger.warn(
              `${LOG_TAG} [Pass 2] No Gemini translation returned for "${candidate.title}"`
            )
          }

          if (book) {
            await this.addBookToResult(book, candidate, result)
          } else {
            result.notFound++
            result.details.notFound.push(`${candidate.title} (no Trackr match)`)
          }
        }
      }

      logger.debug(
        `${LOG_TAG} Import complete: ${result.pendingBooks.length} pending, ${result.alreadyExists} existing, ${result.notFound} not found, ${result.skipped} skipped`
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`${LOG_TAG} Import failed: ${errorMessage}`)
      result.errors.push(`Failed to fetch Mangacollec collection: ${errorMessage}`)
    }

    return result
  }

  /**
   * Load all non-NSFW books from the database once for efficient matching.
   */
  private async loadBooks(): Promise<void> {
    if (this.cachedBooks) return

    this.cachedBooks = await Book.query()
      .select('id', 'title', 'cover_image', 'external_id', 'alternative_titles')
      .where('data_source', 'myanimelist')
      .where((q) => q.where('nsfw', false).orWhereNull('nsfw'))
  }

  /**
   * Match a title against the cached books using normalized exact match and scoring.
   */
  private matchCandidateToBook(title: string): Book | null {
    const books = this.cachedBooks || []
    const candidateNormalized = this.normalizeTitle(title)
    if (!candidateNormalized) return null

    let best: { book: Book; score: number } | null = null

    for (const book of books) {
      const bookTitleNormalized = this.normalizeTitle(book.title)
      if (bookTitleNormalized && bookTitleNormalized === candidateNormalized) {
        logger.debug(
          `${LOG_TAG} [Match] "${title}" exact-title match → "${book.title}" (id=${book.id})`
        )
        return book
      }

      const alternatives = book.alternativeTitles || []
      for (const alt of alternatives) {
        const altNormalized = this.normalizeTitle(alt)
        if (altNormalized && altNormalized === candidateNormalized) {
          logger.debug(
            `${LOG_TAG} [Match] "${title}" exact-alt match on "${alt}" → "${book.title}" (id=${book.id})`
          )
          return book
        }
      }

      const titleScore = this.scoreTitles(title, book.title)
      if (titleScore >= 0.95 && (!best || titleScore > best.score)) {
        logger.debug(
          `${LOG_TAG} [Match] "${title}" score=${titleScore.toFixed(3)} on title "${book.title}" (id=${book.id})`
        )
        best = { book, score: titleScore }
      }

      if (best && best.score >= 0.97) {
        continue
      }

      for (const alt of alternatives) {
        const score = this.scoreTitles(title, alt)
        if (score >= 0.9 && (!best || score > best.score)) {
          logger.debug(
            `${LOG_TAG} [Match] "${title}" score=${score.toFixed(3)} on alt "${alt}" of "${book.title}" (id=${book.id})`
          )
          best = { book, score }
        }
      }
    }

    return best ? best.book : null
  }

  /**
   * Add a matched book to the result, checking for existing tracking.
   */
  private async addBookToResult(
    book: Book,
    candidate: SeriesCandidate,
    result: FetchResult
  ): Promise<void> {
    const existingTracking = await BookTracking.query()
      .where('user_id', this.userId)
      .where('book_id', book.id)
      .first()

    if (existingTracking) {
      result.alreadyExists++
      result.details.alreadyExists.push(book.title)
      return
    }

    const malId = Number(book.externalId)

    result.pendingBooks.push({
      bookId: book.id,
      malId: Number.isFinite(malId) ? malId : 0,
      title: book.title,
      coverImage: book.coverImage,
      status: 'plan_to_read',
      currentChapter: null,
      currentVolume: null,
      rating: null,
      startDate: null,
      finishDate: null,
      notes: `Imported from Mangacollec (${candidate.title})`,
      sourceTitle: candidate.title,
    })
  }

  /**
   * Use Gemini AI with Google Search grounding to resolve French manga titles
   * to their MyAnimeList entry names. Each title is resolved individually
   * for best Google Search accuracy.
   */
  private async resolveWithAi(frenchTitles: string[]): Promise<Map<string, TitleTranslation>> {
    const translations = new Map<string, TitleTranslation>()

    const apiKey = env.get('GEMINI_API_KEY')
    if (!apiKey) {
      logger.warn(`${LOG_TAG} GEMINI_API_KEY not configured, skipping AI resolution`)
      return translations
    }

    const genai = new GoogleGenAI({ apiKey })

    // Process titles with limited concurrency and delay between chunks
    for (let i = 0; i < frenchTitles.length; i += AI_CONCURRENCY) {
      const chunk = frenchTitles.slice(i, i + AI_CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map((title) => this.resolveOneTitleWithRetry(genai, title))
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          translations.set(result.value.french, result.value)
        }
      }

      // Delay between chunks to avoid rate limiting
      if (i + AI_CONCURRENCY < frenchTitles.length) {
        await new Promise((resolve) => setTimeout(resolve, AI_CHUNK_DELAY_MS))
      }
    }

    return translations
  }

  /**
   * Retry wrapper around resolveOneTitle with exponential backoff.
   */
  private async resolveOneTitleWithRetry(
    genai: GoogleGenAI,
    frenchTitle: string
  ): Promise<TitleTranslation | null> {
    for (let attempt = 1; attempt <= AI_RETRY_ATTEMPTS; attempt++) {
      const result = await this.resolveOneTitle(genai, frenchTitle)
      if (result) return result

      if (attempt < AI_RETRY_ATTEMPTS) {
        const delay = AI_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
        logger.warn(
          `${LOG_TAG} [Gemini] Retry ${attempt}/${AI_RETRY_ATTEMPTS} for "${frenchTitle}" in ${delay}ms`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    logger.error(
      `${LOG_TAG} [Gemini] All ${AI_RETRY_ATTEMPTS} attempts failed for "${frenchTitle}"`
    )
    return null
  }

  /**
   * Resolve a single French manga title using Gemini with Google Search.
   */
  private async resolveOneTitle(
    genai: GoogleGenAI,
    frenchTitle: string
  ): Promise<TitleTranslation | null> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      let response
      try {
        response = await genai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `What is the MyAnimeList manga entry name for the French manga "${frenchTitle}"?

Search the web to find the correct MAL entry. Do NOT translate the title literally.

Respond with ONLY a JSON object (no markdown, no explanation):
{"french":"${frenchTitle}","english":"...","japanese":"...","romaji":"...","nsfw":false}

- "romaji": the main title on MyAnimeList (usually romanized Japanese)
- "english": the English title on MAL (null if main title is already in romaji)
- "japanese": the Japanese title in kanji/kana (null if unknown)
- "nsfw": true if this manga is adult/hentai/ecchi/pornographic
- If you cannot find the MAL entry, set english/japanese/romaji to null`,
                },
              ],
            },
          ],
          config: {
            abortSignal: controller.signal,
            tools: [{ googleSearch: {} }],
            maxOutputTokens: 1024,
            temperature: 0,
            thinkingConfig: {
              thinkingBudget: 2048,
            },
          },
        })
      } finally {
        clearTimeout(timeout)
      }

      const responseText = response.text || ''
      const jsonStr = this.extractJsonFromResponse(responseText)
      const parsed = JSON.parse(jsonStr) as TitleTranslation | TitleTranslation[]

      // Handle both single object and array responses
      const entry = Array.isArray(parsed) ? parsed[0] : parsed
      if (entry && entry.french) {
        logger.debug(
          `${LOG_TAG} [Gemini] "${frenchTitle}" → romaji="${entry.romaji}", en="${entry.english}", nsfw=${entry.nsfw}`
        )
        return entry
      }

      logger.warn(`${LOG_TAG} [Gemini] No result for "${frenchTitle}"`)
      return null
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.name === 'AbortError'
            ? `timeout after 30s`
            : error.message
          : 'Unknown error'
      logger.error(`${LOG_TAG} [Gemini] Failed for "${frenchTitle}": ${errorMessage}`)
      return null
    }
  }

  /**
   * Extract JSON array from Gemini's free-form text response.
   * Handles: raw JSON, markdown code blocks (```json ... ```), and text with embedded JSON.
   */
  private extractJsonFromResponse(text: string): string {
    const trimmed = text.trim()

    // Try raw JSON (starts with '{' or '[')
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return trimmed
    }

    // Try markdown code block: ```json ... ``` or ``` ... ```
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim()
    }

    // Try to find a JSON object or array embedded in the text
    const objStart = trimmed.indexOf('{')
    const objEnd = trimmed.lastIndexOf('}')
    if (objStart !== -1 && objEnd > objStart) {
      return trimmed.substring(objStart, objEnd + 1)
    }

    const arrayStart = trimmed.indexOf('[')
    const arrayEnd = trimmed.lastIndexOf(']')
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      return trimmed.substring(arrayStart, arrayEnd + 1)
    }

    logger.warn(`${LOG_TAG} [Gemini] Could not extract JSON from response`)
    return '{}'
  }

  private extractUsername(input: string): string | null {
    const trimmed = input.trim()
    if (!trimmed || trimmed.length < 2) return null
    return trimmed
  }

  private async fetchCollectionHtml(username: string): Promise<string> {
    const url = `${MANGACOLLEC_BASE_URL}/user/${encodeURIComponent(username)}/collection`
    const response = await fetch(url, {
      headers: {
        'User-Agent': MANGACOLLEC_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} when fetching Mangacollec collection`)
    }

    return response.text()
  }

  private extractDataStore(html: string): DataStore {
    const match = html.match(/window\.DATA_STORE\s*=\s*(\{[\s\S]*\})\s*;/)
    if (!match) {
      throw new Error('DATA_STORE not found in Mangacollec page')
    }

    return JSON.parse(match[1]) as DataStore
  }

  /**
   * Build series candidates from the user's actual collection.
   * Uses publicCollection to determine which editions the user owns,
   * then maps those to series. Falls back to all editions if publicCollection
   * is not available. Excludes adult content series.
   */
  private buildSeriesCandidates(dataStore: DataStore, username: string): SeriesCandidate[] {
    const series = dataStore.series?.data || {}
    const editions = dataStore.editions?.data || {}
    const candidates = new Map<string, SeriesCandidate>()

    logger.debug(`${LOG_TAG} DATA_STORE keys: ${Object.keys(dataStore).join(', ')}`)
    logger.debug(
      `${LOG_TAG} DATA_STORE contains ${Object.keys(series).length} series, ${Object.keys(editions).length} editions`
    )

    // Get the user's owned edition IDs from publicCollection
    const ownedEditionIds = this.extractOwnedEditionIds(dataStore, username)

    if (ownedEditionIds) {
      logger.debug(
        `${LOG_TAG} publicCollection found: ${ownedEditionIds.size} owned edition IDs for user "${username}"`
      )
    } else {
      logger.warn(
        `${LOG_TAG} publicCollection not found for user "${username}", falling back to all editions`
      )
    }

    // Determine which editions to iterate over
    const editionsToProcess = ownedEditionIds
      ? Object.values(editions).filter((ed) => ownedEditionIds.has(ed.id))
      : Object.values(editions)

    logger.debug(`${LOG_TAG} Processing ${editionsToProcess.length} editions`)

    let skippedAdult = 0
    for (const edition of editionsToProcess) {
      const seriesId = edition.series_id
      const seriesEntry = series[seriesId]
      const title = seriesEntry?.title
      if (!title) continue

      // Skip adult content series
      if (seriesEntry.adult_content) {
        skippedAdult++
        continue
      }

      const existing = candidates.get(seriesId)
      if (!existing) {
        candidates.set(seriesId, {
          seriesId,
          title,
        })
      }
    }

    if (skippedAdult > 0) {
      logger.debug(`${LOG_TAG} Skipped ${skippedAdult} adult content editions`)
    }

    return Array.from(candidates.values())
  }

  /**
   * Extract the edition IDs that the user actually owns from publicCollection.
   * Returns null if publicCollection data is not available (fallback to all editions).
   */
  private extractOwnedEditionIds(dataStore: DataStore, username: string): Set<string> | null {
    const publicCollection = dataStore.publicCollection
    if (!publicCollection) return null

    const userCollection = publicCollection[username]
    if (!userCollection || !Array.isArray(userCollection) || userCollection.length === 0) {
      return null
    }

    const editionIds = new Set<string>()

    // publicCollection[username] is an array of sublists
    // First sublist contains edition follow entries with edition_id
    for (const sublist of userCollection) {
      if (!Array.isArray(sublist)) continue
      for (const entries of sublist) {
        if (!Array.isArray(entries)) continue
        for (const entry of entries) {
          if (entry && typeof entry === 'object' && 'edition_id' in entry) {
            editionIds.add(entry.edition_id)
          }
        }
      }
    }

    return editionIds.size > 0 ? editionIds : null
  }

  private normalizeTitle(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(tome|volume|vol|vol\.|t)\b\s*\d+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Common words that should not count as meaningful matches
  private static STOP_WORDS = new Set([
    // French
    'le',
    'la',
    'les',
    'de',
    'du',
    'des',
    'un',
    'une',
    'et',
    'en',
    'au',
    'aux',
    // English
    'the',
    'a',
    'an',
    'of',
    'and',
    'in',
    'to',
    'on',
    'at',
    'is',
    'my',
    'no',
    // Japanese romaji particles
    'wa',
    'ga',
    'wo',
    'ni',
    'he',
    'to',
    'mo',
    'ka',
    'na',
  ])

  private filterStopWords(tokens: Set<string>): Set<string> {
    const filtered = new Set<string>()
    for (const token of tokens) {
      if (token.length > 2 || !MangacollecImportService.STOP_WORDS.has(token)) {
        filtered.add(token)
      }
    }
    return filtered
  }

  private scoreTitles(a: string, b: string): number {
    const aNorm = this.normalizeTitle(a)
    const bNorm = this.normalizeTitle(b)
    if (!aNorm || !bNorm) return 0
    if (aNorm === bNorm) return 1

    // Substring match: require the shorter string to be long enough AND
    // the length ratio to be high enough (e.g. "Les Enfants" vs "Les Enfants de la mer" = 0.52 → rejected)
    const shorter = aNorm.length <= bNorm.length ? aNorm : bNorm
    const longer = aNorm.length > bNorm.length ? aNorm : bNorm
    const lengthRatio = shorter.length / longer.length
    if (
      (aNorm.includes(bNorm) || bNorm.includes(aNorm)) &&
      shorter.length >= 8 &&
      lengthRatio >= 0.75
    ) {
      return 0.9
    }

    // Token-based scoring with stop words filtered out
    const aTokens = this.filterStopWords(new Set(aNorm.split(' ')))
    const bTokens = this.filterStopWords(new Set(bNorm.split(' ')))
    if (aTokens.size === 0 || bTokens.size === 0) return 0

    const intersection = [...aTokens].filter((t) => bTokens.has(t)).length
    // Require at least 2 meaningful matching tokens to avoid coincidental single-word matches
    if (intersection < 2) return 0
    const maxTokens = Math.max(aTokens.size, bTokens.size)

    return intersection / maxTokens
  }
}
