import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
import axios from 'axios'
import { Pool } from 'pg'
import { z } from 'zod'

// MangaDex API configuration
const MANGADEX_API_URL = 'https://api.mangadex.org'
const REQUEST_DELAY_MS = 220 // 5 req/sec max = 200ms + margin
const PER_PAGE = 100 // Max allowed by MangaDex API

// Web Comic tag ID for webtoons
const WEB_COMIC_TAG_ID = 'e197df38-d0e7-43b5-9b09-2842d0c326dd'

const ONE_SECOND = 1000
const MAX_FETCH_RETRIES = 5

const pool = new Pool({
  connectionString: env.get('DATABASE_URL'),
  host: env.get('DB_HOST'),
  port: env.get('DB_PORT'),
  user: env.get('DB_USER'),
  password: env.get('DB_PASSWORD'),
  database: env.get('DB_DATABASE'),
  ssl:
    env.get('DB_SSL') === 'true'
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
})

// MangaDex API Schemas
const LocalizedStringSchema = z.record(z.string(), z.string()).optional().nullable()

const TagSchema = z.object({
  id: z.string(),
  type: z.literal('tag'),
  attributes: z.object({
    name: LocalizedStringSchema,
    group: z.string().optional().nullable(),
  }),
})

const RelationshipSchema = z.object({
  id: z.string(),
  type: z.string(),
  attributes: z.record(z.string(), z.any()).optional().nullable(),
})

const MangaAttributesSchema = z.object({
  title: LocalizedStringSchema,
  altTitles: z.array(LocalizedStringSchema).optional().nullable(),
  description: LocalizedStringSchema,
  originalLanguage: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  year: z.number().optional().nullable(),
  contentRating: z.string().optional().nullable(),
  tags: z.array(TagSchema).optional().nullable(),
  state: z.string().optional().nullable(),
})

const MangaSchema = z.object({
  id: z.string(),
  type: z.literal('manga'),
  attributes: MangaAttributesSchema,
  relationships: z.array(RelationshipSchema).optional().nullable(),
})

const ApiResponseSchema = z.object({
  result: z.string(),
  response: z.string(),
  data: z.array(MangaSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
})

const STATUS_MAP: Record<string, 'completed' | 'ongoing' | 'hiatus'> = {
  completed: 'completed',
  ongoing: 'ongoing',
  hiatus: 'hiatus',
  cancelled: 'completed',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeString = (value: string | null | undefined) => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const getLocalizedString = (obj: Record<string, string> | null | undefined): string | null => {
  if (!obj) return null
  // Priority: en > ko > zh > first available
  return obj.en || obj.ko || obj.zh || obj['zh-hk'] || Object.values(obj)[0] || null
}

const uniqueStrings = (values: Array<string | null | undefined>) => {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeString(value))
        .filter((value): value is string => value !== null)
    )
  )
}

const mapMangaToBook = (manga: z.infer<typeof MangaSchema>) => {
  const titleObj = manga.attributes.title
  const primaryTitle = getLocalizedString(titleObj)
  const title = primaryTitle ?? 'Untitled'

  // Collect all alternative titles
  const altTitles = (manga.attributes.altTitles ?? [])
    .map((alt) => getLocalizedString(alt))
    .filter((t): t is string => t !== null)

  const allTitles = [primaryTitle, ...altTitles].filter((t): t is string => t !== null)
  const alternativeTitles = uniqueStrings(allTitles).filter((t) => t !== title)

  // Determine type based on original language
  const originalLang = manga.attributes.originalLanguage
  let type = 'manhwa' // Default for Korean
  if (originalLang === 'zh' || originalLang === 'zh-hk') {
    type = 'manhua'
  }

  // Extract genres from tags with group 'genre'
  const genreTags = (manga.attributes.tags ?? []).filter((tag) => tag.attributes.group === 'genre')
  const genres = genreTags
    .map((tag) => getLocalizedString(tag.attributes.name))
    .filter((g): g is string => g !== null)

  // Get description
  const description = normalizeString(getLocalizedString(manga.attributes.description))
  const cleanDescription = description
    ? description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    : null

  // Get cover image URL from relationships
  let coverImage: string | null = null
  const coverRel = (manga.relationships ?? []).find((rel) => rel.type === 'cover_art')
  if (coverRel?.attributes?.fileName) {
    const fileName = coverRel.attributes.fileName as string
    // MangaDex CDN URL with 512px quality
    coverImage = `https://uploads.mangadex.org/covers/${manga.id}/${fileName}.512.jpg`
  }

  // Get authors from relationships
  const authorRels = (manga.relationships ?? []).filter(
    (rel) => rel.type === 'author' || rel.type === 'artist'
  )
  const authorNames = uniqueStrings(
    authorRels.map((rel) => normalizeString(rel.attributes?.name as string | undefined))
  )

  // Determine NSFW status
  const nsfw = manga.attributes.contentRating === 'erotica'

  // Map status
  const rawStatus = normalizeString(manga.attributes.status)
  const status = STATUS_MAP[rawStatus ?? ''] ?? 'ongoing'

  return {
    title,
    cover_image: coverImage,
    type,
    rating: null,
    genres,
    release_year: manga.attributes.year ?? null,
    end_year: null, // MangaDex doesn't provide end year
    description: cleanDescription,
    description_fr: null,
    status,
    volumes: null, // Not reliably provided
    chapters: null, // Not reliably provided
    alternative_titles: alternativeTitles,
    data_source: 'mangadex',
    external_id: manga.id, // UUID string
    nsfw,
    rating_count: 0,
    authors: authorNames,
  }
}

const prepareArrayParam = (values: string[] | null | undefined) => {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }
  return JSON.stringify(values)
}

const buildInsertParameters = (book: ReturnType<typeof mapMangaToBook>) => [
  book.title,
  book.cover_image,
  book.type,
  book.rating,
  prepareArrayParam(book.genres),
  book.release_year,
  book.end_year,
  book.description,
  book.description_fr,
  book.status,
  book.volumes,
  book.chapters,
  prepareArrayParam(book.alternative_titles),
  book.data_source,
  book.external_id,
  book.nsfw,
  book.rating_count,
]

const buildUpdateParameters = (book: ReturnType<typeof mapMangaToBook>) => [
  book.title,
  book.cover_image,
  book.type,
  book.rating,
  prepareArrayParam(book.genres),
  book.release_year,
  book.end_year,
  book.description,
  book.description_fr,
  book.status,
  book.volumes,
  book.chapters,
  prepareArrayParam(book.alternative_titles),
  book.data_source,
  book.nsfw,
  book.rating_count,
  book.external_id,
  book.data_source,
  R2_URL_PREFIX, // $19 - R2 prefix to preserve synced covers
]

// R2 URL prefix to detect covers already synced to R2
const R2_URL_PREFIX = env.get('R2_PUBLIC_URL') || ''

const updateStatement = `
  UPDATE books
     SET title = $1,
         cover_image = CASE
           WHEN cover_image LIKE $19 || '%' THEN cover_image
           ELSE COALESCE($2, cover_image)
         END,
         type = $3,
         rating = $4,
         genres = $5,
         release_year = $6,
         end_year = $7,
         description = $8,
         description_fr = $9,
         status = $10,
         volumes = $11,
         chapters = $12,
         alternative_titles = $13,
         data_source = $14,
         nsfw = $15,
         rating_count = $16,
         updated_at = NOW()
  WHERE external_id = $17
    AND data_source = $18
  RETURNING id
`

const insertStatement = `
  INSERT INTO books (
    title,
    cover_image,
    type,
    rating,
    genres,
    release_year,
    end_year,
    description,
    description_fr,
    status,
    volumes,
    chapters,
    alternative_titles,
    data_source,
    external_id,
    nsfw,
    rating_count
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17
  )
  RETURNING id
`

type UpsertResult =
  | { action: 'inserted'; bookId: number }
  | { action: 'updated'; bookId: number }
  | { action: 'skipped-duplicate'; reason: 'title-conflict' }

const upsertBook = async (
  client: import('pg').PoolClient,
  book: ReturnType<typeof mapMangaToBook>
): Promise<UpsertResult> => {
  const updateParams = buildUpdateParameters(book)
  const updateResult = await client.query(updateStatement, updateParams)
  if ((updateResult.rowCount ?? 0) > 0) {
    return { action: 'updated' as const, bookId: updateResult.rows[0].id as number }
  }

  try {
    const insertResult = await client.query(insertStatement, buildInsertParameters(book))
    return { action: 'inserted' as const, bookId: insertResult.rows[0].id as number }
  } catch (error: any) {
    if (error?.code === '23505' && error?.constraint === 'books_title_unique') {
      return { action: 'skipped-duplicate' as const, reason: 'title-conflict' as const }
    }
    throw error
  }
}

const syncBookAuthors = async (
  client: import('pg').PoolClient,
  bookId: number,
  authorNames: string[]
) => {
  if (!Array.isArray(authorNames) || authorNames.length === 0) {
    await client.query('BEGIN')
    try {
      await client.query('DELETE FROM author_books WHERE book_id = $1', [bookId])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    return
  }

  await client.query('BEGIN')
  try {
    await client.query(
      `
        INSERT INTO authors (name)
        SELECT DISTINCT new_author.name
        FROM UNNEST($1::text[]) AS new_author(name)
        ON CONFLICT (name) DO NOTHING
      `,
      [authorNames]
    )

    await client.query(
      `
        DELETE FROM author_books
        WHERE book_id = $1
          AND author_id NOT IN (
            SELECT id FROM authors WHERE name = ANY($2::text[])
          )
      `,
      [bookId, authorNames]
    )

    await client.query(
      `
        INSERT INTO author_books (book_id, author_id)
        SELECT $1, a.id
        FROM authors a
        WHERE a.name = ANY($2::text[])
        ON CONFLICT DO NOTHING
      `,
      [bookId, authorNames]
    )

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

const syncAuthorsWithRetry = async (
  client: import('pg').PoolClient,
  bookId: number,
  authorNames: string[]
) => {
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await syncBookAuthors(client, bookId, authorNames)
      return
    } catch (error: any) {
      const isUniqueViolation = error?.code === '23505'
      const isSerializationError = error?.code === '40001'
      const isDeadlock = error?.code === '40P01'

      if (attempt >= MAX_ATTEMPTS || !(isUniqueViolation || isSerializationError || isDeadlock)) {
        throw error
      }

      const backoff = Math.min(REQUEST_DELAY_MS * Math.pow(2, attempt), ONE_SECOND * 5)
      await sleep(backoff)
    }
  }
}

const fetchMangaPage = async (
  offset: number,
  languages: string[],
  logger: { info: (msg: string) => void; error: (msg: string, ...args: any[]) => void }
) => {
  let attempt = 0
  let lastError: unknown

  while (attempt < MAX_FETCH_RETRIES) {
    try {
      // Build query params for manhwa/manhua with web comic tag
      const params = new URLSearchParams()
      params.append('limit', String(PER_PAGE))
      params.append('offset', String(offset))

      // Filter by original language (ko for manhwa, zh for manhua)
      for (const lang of languages) {
        params.append('originalLanguage[]', lang)
      }

      // Include web comic tag for webtoons
      params.append('includedTags[]', WEB_COMIC_TAG_ID)

      // Include relationships to get cover art and authors
      params.append('includes[]', 'cover_art')
      params.append('includes[]', 'author')
      params.append('includes[]', 'artist')

      // Content ratings to include (safe, suggestive, erotica - not pornographic)
      params.append('contentRating[]', 'safe')
      params.append('contentRating[]', 'suggestive')
      params.append('contentRating[]', 'erotica')

      // Order by creation date for consistent pagination
      params.append('order[createdAt]', 'asc')

      const response = await axios.get(`${MANGADEX_API_URL}/manga?${params.toString()}`, {
        headers: {
          'User-Agent': 'Trackr Data Importer/1.0',
          'Accept': 'application/json',
        },
      })

      return ApiResponseSchema.parse(response.data)
    } catch (error) {
      attempt += 1
      lastError = error

      if (axios.isAxiosError(error)) {
        const status = error.response?.status

        // Rate limit handling
        if (status === 429 && attempt < MAX_FETCH_RETRIES) {
          const retryAfter = error.response?.headers['retry-after']
          const backoff = retryAfter
            ? Number(retryAfter) * ONE_SECOND
            : Math.min(REQUEST_DELAY_MS * Math.pow(2, attempt), 60 * ONE_SECOND)

          logger.info(
            `Rate limit hit at offset ${offset}. Retrying in ${backoff}ms (attempt ${attempt}/${MAX_FETCH_RETRIES}).`
          )
          await sleep(backoff)
          continue
        }

        // Server errors - retry with backoff
        if (status && status >= 500 && attempt < MAX_FETCH_RETRIES) {
          const backoff = Math.min(REQUEST_DELAY_MS * Math.pow(2, attempt), 30 * ONE_SECOND)
          logger.info(`Server error (${status}) at offset ${offset}. Retrying in ${backoff}ms.`)
          await sleep(backoff)
          continue
        }

        logger.error(`HTTP error at offset ${offset}:`, status, error.response?.statusText)
      }

      throw error
    }
  }

  throw lastError
}

export default class ImportMangadex extends BaseCommand {
  static commandName = 'import:mangadex'
  static description = 'Import webtoons (manhwa, manhua) from MangaDex API into Trackr database'

  static options: CommandOptions = {}

  @flags.number({ description: 'Maximum number of manga to import' })
  declare limit?: number

  @flags.number({ description: 'Offset to resume import from' })
  declare offset?: number

  @flags.string({ description: 'Filter by original language: ko (Korean), zh (Chinese), or both' })
  declare language?: string

  async run() {
    this.logger.info('Importing webtoons from MangaDex API...')

    // Determine languages to import
    let languages: string[] = ['ko', 'zh', 'zh-hk']
    if (this.language === 'ko') {
      languages = ['ko']
      this.logger.info('Filtering: Korean manhwa only')
    } else if (this.language === 'zh') {
      languages = ['zh', 'zh-hk']
      this.logger.info('Filtering: Chinese manhua only')
    } else {
      this.logger.info('Importing both Korean manhwa and Chinese manhua')
    }

    const client = await pool.connect()
    this.logger.info('Connected to database')

    try {
      let currentOffset = this.offset ?? 0
      let totalInserted = 0
      let totalUpdated = 0
      let totalSkipped = 0
      let totalDuplicateTitle = 0
      let processedCount = 0

      while (true) {
        // Check limit
        if (this.limit && processedCount >= this.limit) {
          this.logger.info(`Reached limit of ${this.limit} manga. Stopping.`)
          break
        }

        this.logger.info(`Fetching manga at offset ${currentOffset}...`)
        const response = await fetchMangaPage(currentOffset, languages, this.logger)
        const { data: mangaList, total } = response

        if (mangaList.length === 0) {
          this.logger.info('No more manga available. Done.')
          break
        }

        this.logger.info(`Total available: ${total}, fetched: ${mangaList.length}`)

        for (const manga of mangaList) {
          // Check limit again for each manga
          if (this.limit && processedCount >= this.limit) {
            break
          }

          // Skip drafts or non-published manga
          if (manga.attributes.state && manga.attributes.state !== 'published') {
            totalSkipped += 1
            continue
          }

          const book = mapMangaToBook(manga)

          try {
            const result = await upsertBook(client, book)
            if (result.action === 'inserted') {
              totalInserted += 1
              await syncAuthorsWithRetry(client, result.bookId, book.authors)
            } else if (result.action === 'updated') {
              totalUpdated += 1
              await syncAuthorsWithRetry(client, result.bookId, book.authors)
            } else if (result.action === 'skipped-duplicate') {
              totalDuplicateTitle += 1
            }
          } catch (error: any) {
            this.logger.error(`Failed to upsert MangaDex ${manga.id}: ${error.message ?? error}`)
            totalSkipped += 1
          }

          processedCount += 1
        }

        // Progress update
        this.logger.info(
          `Progress: offset ${currentOffset}, inserted: ${totalInserted}, updated: ${totalUpdated}, duplicates: ${totalDuplicateTitle}, skipped: ${totalSkipped}`
        )

        // Check if we've reached the end
        currentOffset += mangaList.length
        if (currentOffset >= total) {
          this.logger.info('Reached end of available manga. Done.')
          break
        }

        // Rate limit delay between pages
        await sleep(REQUEST_DELAY_MS)
      }

      this.logger.info('Import complete.')
      this.logger.info(
        `Totals — inserted: ${totalInserted}, updated: ${totalUpdated}, duplicates: ${totalDuplicateTitle}, skipped: ${totalSkipped}, processed: ${processedCount}`
      )
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error(`Fatal error during import: ${err.message}`)
      if (err.stack) {
        this.logger.error(err.stack)
      }
      throw err
    } finally {
      client.release()
      await pool.end()
    }
  }
}
