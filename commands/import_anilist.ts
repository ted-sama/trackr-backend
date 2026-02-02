import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
import axios from 'axios'
import { Pool } from 'pg'
import { z } from 'zod'

const REQUEST_DELAY_MS = Number(process.env.ANILIST_REQUEST_DELAY_MS ?? 700)
const START_PAGE = Number(process.env.ANILIST_START_PAGE ?? 1)
const MAX_PAGES = process.env.ANILIST_MAX_PAGES ? Number(process.env.ANILIST_MAX_PAGES) : undefined
const PER_PAGE = 50

const GRAPHQL_API_URL = 'https://graphql.anilist.co'
const RATE_LIMITS = {
  maxPerMinute: 90,
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

const MediaTitleSchema = z.object({
  romaji: z.string().nullable().optional(),
  english: z.string().nullable().optional(),
  native: z.string().nullable().optional(),
})

const CoverImageSchema = z.object({
  extraLarge: z.string().nullable().optional(),
  large: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
})

const DateSchema = z.object({
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
  day: z.number().nullable().optional(),
})

const StaffSchema = z.object({
  edges: z
    .array(
      z.object({
        role: z.string().nullable().optional(),
        node: z
          .object({
            name: z
              .object({
                full: z.string().nullable().optional(),
              })
              .nullable()
              .optional(),
          })
          .nullable()
          .optional(),
      })
    )
    .optional(),
})

const MediaSchema = z.object({
  id: z.number(),
  idMal: z.number().nullable().optional(),
  title: MediaTitleSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  coverImage: CoverImageSchema.nullable().optional(),
  format: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  chapters: z.number().nullable().optional(),
  volumes: z.number().nullable().optional(),
  averageScore: z.number().nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  tags: z
    .array(
      z.object({
        name: z.string(),
        isMediaSpoiler: z.boolean().nullable().optional(),
      })
    )
    .nullable()
    .optional(),
  startDate: DateSchema.nullable().optional(),
  endDate: DateSchema.nullable().optional(),
  countryOfOrigin: z.string().nullable().optional(),
  isAdult: z.boolean().nullable().optional(),
  staff: StaffSchema.nullable().optional(),
})

const PageInfoSchema = z.object({
  currentPage: z.number(),
  hasNextPage: z.boolean(),
  perPage: z.number(),
})

const ApiResponseSchema = z.object({
  data: z.object({
    Page: z.object({
      pageInfo: PageInfoSchema,
      media: z.array(MediaSchema),
    }),
  }),
})

const STATUS_MAP: Record<string, 'completed' | 'ongoing' | 'hiatus'> = {
  FINISHED: 'completed',
  RELEASING: 'ongoing',
  CANCELLED: 'completed',
  HIATUS: 'hiatus',
  NOT_YET_RELEASED: 'ongoing',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForRateLimit = async () => {
  while (true) {
    const now = Date.now()

    while (rateLimitTimestamps.length > 0 && now - rateLimitTimestamps[0] >= ONE_MINUTE) {
      rateLimitTimestamps.shift()
    }

    const requestsLastMinute = rateLimitTimestamps.length
    const lastRequestAt = rateLimitTimestamps[rateLimitTimestamps.length - 1]
    const timeSinceLastRequest =
      lastRequestAt !== undefined ? now - lastRequestAt : Number.POSITIVE_INFINITY
    const requiredDelay = REQUEST_DELAY_MS - timeSinceLastRequest

    const underPerMinuteLimit = requestsLastMinute < RATE_LIMITS.maxPerMinute
    const spacingSatisfied = requiredDelay <= 0

    if (underPerMinuteLimit && spacingSatisfied) {
      rateLimitTimestamps.push(Date.now())
      return
    }

    const waitForMinute = !underPerMinuteLimit ? ONE_MINUTE - (now - rateLimitTimestamps[0]) : 0
    const waitForSpacing = spacingSatisfied ? 0 : requiredDelay
    const waitTime = Math.max(waitForMinute, waitForSpacing, 50)

    await sleep(waitTime)
  }
}

const normalizeString = (value: string | null | undefined) => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
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

const mapMediaToBook = (media: z.infer<typeof MediaSchema>) => {
  const englishTitle = normalizeString(media.title?.english)
  const romajiTitle = normalizeString(media.title?.romaji)
  const nativeTitle = normalizeString(media.title?.native)
  const title = englishTitle ?? romajiTitle ?? nativeTitle ?? 'Untitled'

  const alternativeTitles = uniqueStrings([englishTitle, romajiTitle, nativeTitle]).filter(
    (candidate) => candidate !== title
  )

  const genreNames = uniqueStrings(media.genres ?? [])

  const releaseYear = media.startDate?.year ?? null
  const endYear = media.endDate?.year ?? null

  const authorNames = uniqueStrings(
    (media.staff?.edges ?? [])
      .filter(
        (edge) =>
          edge.role &&
          (edge.role.toLowerCase().includes('story') || edge.role.toLowerCase().includes('art'))
      )
      .map((edge) => formatAuthorName(edge.node?.name?.full))
      .filter((value): value is string => value !== null)
  )

  const description = normalizeString(media.description)
  const cleanDescription = description
    ? description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    : null

  return {
    title,
    cover_image:
      normalizeString(media.coverImage?.extraLarge) ??
      normalizeString(media.coverImage?.large) ??
      normalizeString(media.coverImage?.medium) ??
      null,
    type: 'manhwa',
    rating: null,
    genres: genreNames,
    release_year: releaseYear,
    end_year: endYear,
    description: cleanDescription,
    description_fr: null,
    status: STATUS_MAP[normalizeString(media.status) ?? ''] ?? 'ongoing',
    volumes: media.volumes ?? null,
    chapters: media.chapters ?? null,
    alternative_titles: alternativeTitles,
    data_source: 'anilist',
    external_id: media.id,
    nsfw: media.isAdult ?? false,
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

const buildInsertParameters = (book: ReturnType<typeof mapMediaToBook>) => [
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

// R2 URL prefix to detect covers already synced to R2
const R2_URL_PREFIX = env.get('R2_PUBLIC_URL') || ''

const buildUpdateParameters = (book: ReturnType<typeof mapMediaToBook>) => [
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

const updateStatement = `
  UPDATE books
     SET title = $1,
         cover_image = CASE
           WHEN cover_image LIKE $19 || '%' THEN cover_image
           ELSE COALESCE($2, cover_image)
         END,
         type = $3,
         rating = rating,
         genres = $5,
         release_year = $6,
         end_year = $7,
         description = $8,
         description_fr = CASE
           WHEN $8 IS NOT DISTINCT FROM description THEN description_fr
           ELSE NULL
         END,
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
  book: ReturnType<typeof mapMediaToBook>
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

const MANHWA_QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        currentPage
        hasNextPage
        perPage
      }
      media(
        type: MANGA
        countryOfOrigin: "KR"
        sort: ID
      ) {
        id
        idMal
        title {
          romaji
          english
          native
        }
        description
        coverImage {
          extraLarge
          large
          medium
        }
        format
        status
        chapters
        volumes
        averageScore
        genres
        tags {
          name
          isMediaSpoiler
        }
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        countryOfOrigin
        isAdult
        staff(perPage: 25) {
          edges {
            role
            node {
              name {
                full
              }
            }
          }
        }
      }
    }
  }
`

const fetchManhwaPage = async (page: number) => {
  try {
    await waitForRateLimit()
    let attempt = 0
    let lastError: unknown

    while (attempt < MAX_FETCH_RETRIES) {
      try {
        const response = await axios.post(
          GRAPHQL_API_URL,
          {
            query: MANHWA_QUERY,
            variables: {
              page,
              perPage: PER_PAGE,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'Trackr Data Importer/1.0',
            },
          }
        )

        if (response.data.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`)
        }

        return ApiResponseSchema.parse(response.data)
      } catch (error) {
        attempt += 1
        lastError = error

        if (
          axios.isAxiosError(error) &&
          error.response?.status === 429 &&
          attempt < MAX_FETCH_RETRIES
        ) {
          const retryAfter = error.response.headers['retry-after']
          const backoff = retryAfter
            ? Number(retryAfter) * ONE_SECOND
            : Math.min(REQUEST_DELAY_MS * Math.pow(2, attempt), ONE_MINUTE)

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
      const response = await fetchManhwaPage(page)
      const { media: manhwaList, pageInfo } = response.data.Page

      for (const manhwa of manhwaList) {
        const book = mapMediaToBook(manhwa)

        if (!book.status || !['completed', 'ongoing', 'hiatus'].includes(book.status)) {
          logger.info(
            `Skipping AniList ${manhwa.id}: status "${manhwa.status}" could not be normalized.`
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
          logger.error(`Failed to upsert AniList ${manhwa.id}: ${error.message ?? error}`)
          totalSkipped += 1
        }
      }

      processedPages += 1
      logger.info(
        `Page ${page} processed. totals — inserted: ${totalInserted}, updated: ${totalUpdated}, duplicates: ${totalDuplicateTitle}, skipped: ${totalSkipped}`
      )

      if (!pageInfo.hasNextPage) {
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

export default class ImportAnilist extends BaseCommand {
  static commandName = 'import:anilist'
  static description = 'Import all AniList Korean manhwa entries into Trackr database'

  static options: CommandOptions = {}

  async run() {
    this.logger.info('Importing AniList Korean manhwa entries into Trackr database...')
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
