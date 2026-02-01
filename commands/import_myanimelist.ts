import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
import axios from 'axios'
import { Pool } from 'pg'
import { z } from 'zod'

const REQUEST_DELAY_MS = Number(process.env.JIKAN_REQUEST_DELAY_MS ?? 1200)
const START_PAGE = Number(process.env.JIKAN_START_PAGE ?? 1)
const MAX_PAGES = process.env.JIKAN_MAX_PAGES ? Number(process.env.JIKAN_MAX_PAGES) : undefined

const MANGA_API_URL = 'https://api.jikan.moe/v4/manga'
const RATE_LIMITS = {
  maxPerSecond: 3,
  maxPerMinute: 60,
}
const MAX_FETCH_RETRIES = 5
const ONE_SECOND = 1000
const ONE_MINUTE = 60 * ONE_SECOND

const rateLimitTimestamps: number[] = []

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

const MangaSchema = z.object({
  mal_id: z.number(),
  title: z.string().nullable().optional(),
  title_english: z.string().nullable().optional(),
  title_japanese: z.string().nullable().optional(),
  titles: z
    .array(
      z.object({
        type: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
      })
    )
    .optional(),
  synopsis: z.string().nullable().optional(),
  images: z
    .object({
      webp: z
        .object({
          image_url: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      jpg: z
        .object({
          image_url: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
  type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  volumes: z.number().nullable().optional(),
  chapters: z.number().nullable().optional(),
  score: z.number().nullable().optional(),
  scored_by: z.number().nullable().optional(),
  genres: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
      })
    )
    .optional(),
  themes: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
      })
    )
    .optional(),
  demographics: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
      })
    )
    .optional(),
  explicit_genres: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
      })
    )
    .optional(),
  published: z
    .object({
      from: z.string().nullable().optional(),
      to: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  authors: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
      })
    )
    .optional(),
  rating: z.string().nullable().optional(),
})

const PaginationSchema = z.object({
  last_visible_page: z.number(),
  has_next_page: z.boolean(),
})

const ApiResponseSchema = z.object({
  data: z.array(MangaSchema),
  pagination: PaginationSchema,
})

const STATUS_MAP: Record<string, 'completed' | 'ongoing' | 'hiatus'> = {
  'Finished': 'completed',
  'Publishing': 'ongoing',
  'On Hiatus': 'hiatus',
}

const NSFW_RATINGS = new Set(['Rx', 'R+', 'R - 17+'])

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForRateLimit = async () => {
  while (true) {
    const now = Date.now()

    while (rateLimitTimestamps.length > 0 && now - rateLimitTimestamps[0] >= ONE_MINUTE) {
      rateLimitTimestamps.shift()
    }

    const recentSecond = rateLimitTimestamps.filter((timestamp) => now - timestamp < ONE_SECOND)
    const requestsLastMinute = rateLimitTimestamps.length
    const lastRequestAt = rateLimitTimestamps[rateLimitTimestamps.length - 1]
    const timeSinceLastRequest =
      lastRequestAt !== undefined ? now - lastRequestAt : Number.POSITIVE_INFINITY
    const requiredDelay = REQUEST_DELAY_MS - timeSinceLastRequest

    const underPerSecondLimit = recentSecond.length < RATE_LIMITS.maxPerSecond
    const underPerMinuteLimit = requestsLastMinute < RATE_LIMITS.maxPerMinute
    const spacingSatisfied = requiredDelay <= 0

    if (underPerSecondLimit && underPerMinuteLimit && spacingSatisfied) {
      rateLimitTimestamps.push(Date.now())
      return
    }

    const waitForSecond = !underPerSecondLimit ? ONE_SECOND - (now - recentSecond[0]) : 0
    const waitForMinute = !underPerMinuteLimit ? ONE_MINUTE - (now - rateLimitTimestamps[0]) : 0
    const waitForSpacing = spacingSatisfied ? 0 : requiredDelay
    const waitTime = Math.max(waitForSecond, waitForMinute, waitForSpacing, 50)

    await sleep(waitTime)
  }
}

const normalizeString = (value: string | null | undefined) => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const toYear = (dateLike: string | null | undefined) => {
  if (!dateLike) return null
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.getUTCFullYear()
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

const formatAuthorName = (name: string | null | undefined) => {
  const normalized = normalizeString(name)
  if (!normalized) {
    return null
  }

  const segments = normalized
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  if (segments.length < 2) {
    return normalized
  }

  const [lastName, ...rest] = segments
  const firstNames = rest.join(' ').trim()

  if (!firstNames.length) {
    return normalized
  }

  const formatted = `${firstNames} ${lastName}`.trim()
  return formatted.length ? formatted : normalized
}

const isNsfw = (manga: z.infer<typeof MangaSchema>) => {
  const explicitGenreNames = uniqueStrings(manga.explicit_genres?.map((item) => item.name) ?? [])
  if (explicitGenreNames.length > 0) return true
  const rating = normalizeString(manga.rating)
  return rating ? NSFW_RATINGS.has(rating) : false
}

const normalizeType = (type: string | null | undefined): string => {
  const normalized = normalizeString(type)?.toLowerCase()

  if (!normalized) return 'manga'

  if (normalized === 'light novel') return 'light_novel'
  if (normalized === 'novel') return 'novel'
  if (normalized === 'manhwa') return 'manhwa'
  if (normalized === 'manhua') return 'manhua'

  // manga, one-shot, doujinshi, etc. -> manga
  return 'manga'
}

const mapMangaToBook = (manga: z.infer<typeof MangaSchema>) => {
  const genreNames = uniqueStrings([
    ...(manga.genres ?? []).map((item) => item.name),
    ...(manga.themes ?? []).map((item) => item.name),
    ...(manga.demographics ?? []).map((item) => item.name),
  ])

  // const themeNames = uniqueStrings((manga.themes ?? []).map((item) => item.name))
  // const explicitGenreNames = uniqueStrings((manga.explicit_genres ?? []).map((item) => item.name))

  // const tagNames = uniqueStrings([
  //   ...explicitGenreNames,
  //   ...themeNames.filter((name) => !genreNames.includes(name)),
  // ])

  const englishTitle = normalizeString(manga.title_english)
  const defaultTitle = normalizeString(manga.title)
  const fallbackTitles = uniqueStrings((manga.titles ?? []).map((item) => item.title))
  const title = englishTitle ?? defaultTitle ?? fallbackTitles[0] ?? 'Untitled'

  const alternativeTitles = uniqueStrings([
    englishTitle,
    normalizeString(manga.title_japanese),
    defaultTitle,
    ...fallbackTitles,
  ]).filter((candidate) => candidate !== title)

  const authorNames = uniqueStrings(
    (manga.authors ?? [])
      .map((author) => formatAuthorName(author.name))
      .filter((value): value is string => value !== null)
  )

  return {
    title,
    cover_image:
      normalizeString((manga.images?.webp as Record<string, string>)?.large_image_url) ??
      normalizeString((manga.images?.jpg as Record<string, string>)?.large_image_url) ??
      normalizeString(manga.images?.webp?.image_url) ??
      normalizeString(manga.images?.jpg?.image_url) ??
      null,
    type: normalizeType(manga.type),
    rating: null,
    genres: genreNames,
    release_year: toYear(manga.published?.from),
    end_year: toYear(manga.published?.to),
    description: normalizeString(manga.synopsis),
    description_fr: null,
    status: STATUS_MAP[normalizeString(manga.status) ?? ''] ?? 'ongoing',
    volumes: manga.volumes ?? null,
    chapters: manga.chapters ?? null,
    alternative_titles: alternativeTitles,
    data_source: 'myanimelist',
    external_id: manga.mal_id,
    nsfw: isNsfw(manga),
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
  // prepareArrayParam(book.tags),
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

// R2 URL prefix to detect covers already synced to R2
const R2_URL_PREFIX = env.get('R2_PUBLIC_URL') || ''

const buildUpdateParameters = (book: ReturnType<typeof mapMangaToBook>) => [
  book.title,
  book.cover_image,
  book.type,
  book.rating,
  prepareArrayParam(book.genres),
  // prepareArrayParam(book.tags),
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

const fetchMangaPage = async (page: number) => {
  try {
    await waitForRateLimit()
    let attempt = 0
    let lastError: unknown

    while (attempt < MAX_FETCH_RETRIES) {
      try {
        const response = await axios.get(MANGA_API_URL, {
          params: { page, order_by: 'mal_id', sort: 'asc' },
          headers: { 'User-Agent': 'Trackr Data Importer/1.0 (https://docs.api.jikan.moe/)' },
        })
        return ApiResponseSchema.parse(response.data)
      } catch (error) {
        attempt += 1
        lastError = error
        if (
          axios.isAxiosError(error) &&
          error.response?.status === 429 &&
          attempt < MAX_FETCH_RETRIES
        ) {
          const backoff = Math.min(REQUEST_DELAY_MS * Math.pow(2, attempt), ONE_MINUTE)
          console.warn(
            `Rate limit hit fetching page ${page}. Retrying in ${backoff}ms (attempt ${attempt}/${MAX_FETCH_RETRIES}).`
          )
          await sleep(backoff)
          continue
        }
        throw error
      }
    }

    throw lastError
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `HTTP error fetching page ${page}:`,
        error.response?.status,
        error.response?.statusText
      )
      if (error.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2))
      }
    } else {
      console.error(`Unexpected error fetching page ${page}:`, error)
    }
    throw error
  }
}

const runImport = async (logger: BaseCommand['logger']) => {
  const client = await pool.connect()
  logger.info('Connected to database')

  try {
    let page = START_PAGE
    let processedPages = 0
    let totalInserted = 0
    let totalUpdated = 0
    let totalSkipped = 0
    let totalDuplicateTitle = 0

    while (true) {
      if (MAX_PAGES && processedPages >= MAX_PAGES) {
        logger.info(`Reached max pages limit (${MAX_PAGES}). Stopping.`)
        break
      }

      logger.info(`Fetching page ${page}...`)
      const { data: mangaList, pagination } = await fetchMangaPage(page)

      for (const manga of mangaList) {
        const book = mapMangaToBook(manga)

        if (!book.status || !['completed', 'ongoing', 'hiatus'].includes(book.status)) {
          logger.info(
            `Skipping MAL ${manga.mal_id}: status "${manga.status}" could not be normalized.`
          )
          totalSkipped += 1
          continue
        }

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
          logger.error(`Failed to upsert MAL ${manga.mal_id}: ${error.message ?? error}`)
          totalSkipped += 1
        }
      }

      processedPages += 1
      logger.info(
        `Page ${page} processed. totals — inserted: ${totalInserted}, updated: ${totalUpdated}, duplicates: ${totalDuplicateTitle}, skipped: ${totalSkipped}`
      )

      if (!pagination.has_next_page) {
        logger.info('No more pages available from API. Done.')
        break
      }

      page += 1
      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS)
      }
    }

    logger.info('Import complete.')
    logger.info(
      `Totals — inserted: ${totalInserted}, updated: ${totalUpdated}, duplicates: ${totalDuplicateTitle}, skipped: ${totalSkipped}, pages: ${processedPages}`
    )
  } finally {
    client.release()
    await pool.end()
  }
}

export default class ImportMyanimelist extends BaseCommand {
  static commandName = 'import:myanimelist'
  static description = 'Import all MyAnimeList manga entries into Trackr database'

  static options: CommandOptions = {}

  async run() {
    this.logger.info('Importing MyAnimeList manga entries into Trackr database...')
    try {
      await runImport(this.logger)
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error(`Fatal error during import: ${err.message}`)
      if (err.stack) {
        this.logger.error(err.stack)
      }
      throw err
    }
  }
}
