/*
 * Script: import_manga.js
 * Description: Fetches manga data from the Jikan (MyAnimeList) API and upserts it into
 *              the Trackr `books` table.
 * Usage: node import_manga.js
 * Environment:
 *   - DATABASE_URL or (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME)
 *   - DB_SSL (optional, "true" to enable SSL)
 *   - JIKAN_START_PAGE (optional, default 1)
 *   - JIKAN_MAX_PAGES (optional, limit the number of pages processed)
 *   - JIKAN_REQUEST_DELAY_MS (optional, default 650ms between API calls)
 */

import axios from 'axios'
import { Pool } from 'pg'
import { z } from 'zod'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DATABASE_URL ? undefined : process.env.DB_HOST,
  port: process.env.DATABASE_URL ? undefined : Number(process.env.DB_PORT) || undefined,
  user: process.env.DATABASE_URL ? undefined : process.env.DB_USER,
  password: process.env.DATABASE_URL ? undefined : process.env.DB_PASSWORD,
  database: process.env.DATABASE_URL ? undefined : process.env.DB_DATABASE,
  ssl:
    process.env.DB_SSL === 'true'
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
})

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
const rateLimitTimestamps = []

const waitForRateLimit = async () => {
  while (true) {
    const now = Date.now()

    while (rateLimitTimestamps.length > 0 && now - rateLimitTimestamps[0] >= ONE_MINUTE) {
      rateLimitTimestamps.shift()
    }

    const recentSecond = rateLimitTimestamps.filter((timestamp) => now - timestamp < ONE_SECOND)
    const requestsLastMinute = rateLimitTimestamps.length
    const lastRequestAt = rateLimitTimestamps[rateLimitTimestamps.length - 1]
    const timeSinceLastRequest = lastRequestAt !== undefined ? now - lastRequestAt : Number.POSITIVE_INFINITY
    const requiredDelay = REQUEST_DELAY_MS - timeSinceLastRequest

    const underPerSecondLimit = recentSecond.length < RATE_LIMITS.maxPerSecond
    const underPerMinuteLimit = requestsLastMinute < RATE_LIMITS.maxPerMinute
    const spacingSatisfied = requiredDelay <= 0

    if (underPerSecondLimit && underPerMinuteLimit && spacingSatisfied) {
      rateLimitTimestamps.push(Date.now())
      return
    }

    const waitForSecond = !underPerSecondLimit
      ? ONE_SECOND - (now - recentSecond[0])
      : 0
    const waitForMinute = !underPerMinuteLimit ? ONE_MINUTE - (now - rateLimitTimestamps[0]) : 0
    const waitForSpacing = spacingSatisfied ? 0 : requiredDelay
    const waitTime = Math.max(waitForSecond, waitForMinute, waitForSpacing, 50)

    await sleep(waitTime)
  }
}

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

const STATUS_MAP = {
  Finished: 'completed',
  Publishing: 'ongoing',
  'On Hiatus': 'hiatus',
}

const NSFW_RATINGS = new Set(['Rx', 'R+', 'R - 17+'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeString = (value) => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const toYear = (dateLike) => {
  if (!dateLike) return null
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.getUTCFullYear()
}

const uniqueStrings = (values) => {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeString(value))
        .filter((value) => value !== null)
    )
  )
}

const isNsfw = (manga) => {
  const explicitGenreNames = uniqueStrings(manga.explicit_genres?.map((item) => item.name))
  if (explicitGenreNames.length > 0) return true
  const rating = normalizeString(manga.rating)
  return rating ? NSFW_RATINGS.has(rating) : false
}

const mapMangaToBook = (manga) => {
  const genreNames = uniqueStrings([
    ...(manga.genres ?? []).map((item) => item.name),
    ...(manga.themes ?? []).map((item) => item.name),
    ...(manga.demographics ?? []).map((item) => item.name),
  ])

  const themeNames = uniqueStrings((manga.themes ?? []).map((item) => item.name))
  const explicitGenreNames = uniqueStrings((manga.explicit_genres ?? []).map((item) => item.name))

  const tagNames = uniqueStrings([
    ...explicitGenreNames,
    ...themeNames.filter((name) => !genreNames.includes(name)),
  ])

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

  const authorNames = uniqueStrings((manga.authors ?? []).map((author) => author.name))

  return {
    title,
    cover_image:
      normalizeString(manga.images?.webp?.image_url) ?? normalizeString(manga.images?.jpg?.image_url) ?? null,
    type: normalizeString(manga.type),
    rating: null,
    genres: genreNames,
    tags: tagNames,
    release_year: toYear(manga.published?.from),
    end_year: toYear(manga.published?.to),
    author: authorNames.join(', ') || null,
    description: normalizeString(manga.synopsis),
    description_fr: null,
    status: STATUS_MAP[normalizeString(manga.status)] ?? 'ongoing',
    volumes: manga.volumes ?? null,
    chapters: manga.chapters ?? null,
    alternative_titles: alternativeTitles,
    data_source: 'myanimelist',
    external_id: manga.mal_id,
    nsfw: isNsfw(manga),
    rating_count: 0,
  }
}

const prepareArrayParam = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }
  return JSON.stringify(values)
}

const buildInsertParameters = (book) => [
  book.title,
  book.cover_image,
  book.type,
  book.rating,
  prepareArrayParam(book.genres),
  prepareArrayParam(book.tags),
  book.release_year,
  book.end_year,
  book.author,
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

const buildUpdateParameters = (book) => [
  book.title,
  book.cover_image,
  book.type,
  book.rating,
  prepareArrayParam(book.genres),
  prepareArrayParam(book.tags),
  book.release_year,
  book.end_year,
  book.author,
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
]

const updateStatement = `
  UPDATE books
     SET title = $1,
         cover_image = $2,
         type = $3,
         rating = $4,
         genres = $5,
         tags = $6,
         release_year = $7,
         end_year = $8,
         author = $9,
         description = $10,
         description_fr = $11,
         status = $12,
         volumes = $13,
         chapters = $14,
         alternative_titles = $15,
         data_source = $16,
         nsfw = $17,
         rating_count = $18,
         updated_at = NOW()
   WHERE external_id = $19
     AND data_source = $20
`

const insertStatement = `
  INSERT INTO books (
    title,
    cover_image,
    type,
    rating,
    genres,
    tags,
    release_year,
    end_year,
    author,
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
    $11, $12, $13, $14, $15, $16, $17, $18, $19
  )
`

const upsertBook = async (client, book) => {
  const updateParams = buildUpdateParameters(book)

  const updateResult = await client.query(updateStatement, updateParams)
  if (updateResult.rowCount > 0) {
    return { action: 'updated' }
  }

  try {
    await client.query(insertStatement, buildInsertParameters(book))
    return { action: 'inserted' }
  } catch (error) {
    if (error?.code === '23505' && error?.constraint === 'books_title_unique') {
      return { action: 'skipped-duplicate', reason: 'title-conflict' }
    }
    throw error
  }
}

const fetchMangaPage = async (page) => {
  try {
    await waitForRateLimit()
    let attempt = 0
    let lastError

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
        if (axios.isAxiosError(error) && error.response?.status === 429 && attempt < MAX_FETCH_RETRIES) {
          const backoff = Math.min(REQUEST_DELAY_MS * Math.pow(2, attempt), ONE_MINUTE)
          console.warn(`Rate limit hit fetching page ${page}. Retrying in ${backoff}ms (attempt ${attempt}/${MAX_FETCH_RETRIES}).`)
          await sleep(backoff)
          continue
        }
        throw error
      }
    }

    throw lastError
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`HTTP error fetching page ${page}:`, error.response?.status, error.response?.statusText)
      if (error.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2))
      }
    } else {
      console.error(`Unexpected error fetching page ${page}:`, error)
    }
    throw error
  }
}

const main = async () => {
  const client = await pool.connect()
  console.log('Connected to database')

  try {
    let page = START_PAGE
    let processedPages = 0
    let totalInserted = 0
    let totalUpdated = 0
    let totalSkipped = 0
    let totalDuplicateTitle = 0

    while (true) {
      if (MAX_PAGES && processedPages >= MAX_PAGES) {
        console.log(`Reached max pages limit (${MAX_PAGES}). Stopping.`)
        break
      }

      console.log(`Fetching page ${page}...`)
      const { data: mangaList, pagination } = await fetchMangaPage(page)

      for (const manga of mangaList) {
        const book = mapMangaToBook(manga)

        if (!book.status || !['completed', 'ongoing', 'hiatus'].includes(book.status)) {
          console.warn(
            `Skipping MAL ${manga.mal_id}: status "${manga.status}" could not be normalized to Trackr enum.`
          )
          totalSkipped += 1
          continue
        }

        try {
          const result = await upsertBook(client, book)
          if (result.action === 'inserted') {
            totalInserted += 1
          } else if (result.action === 'updated') {
            totalUpdated += 1
          } else if (result.action === 'skipped-duplicate') {
            totalDuplicateTitle += 1
          }
        } catch (error) {
          console.error(`Failed to upsert MAL ${manga.mal_id}:`, error.message ?? error)
          totalSkipped += 1
        }
      }

      processedPages += 1
      console.log(
        `Page ${page} processed. Running totals — inserted: ${totalInserted}, updated: ${totalUpdated}, duplicates: ${totalDuplicateTitle}, skipped: ${totalSkipped}`
      )

      if (!pagination.has_next_page) {
        console.log('No more pages available from API. Done.')
        break
      }

      page += 1
      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS)
      }
    }

    console.log('Import complete.')
    console.log({ totalInserted, totalUpdated, totalDuplicateTitle, totalSkipped, processedPages })
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(async (error) => {
  console.error('Fatal error during import:', error)
  await pool.end().catch(() => {})
  process.exit(1)
})

