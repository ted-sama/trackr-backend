/**
 * MyAnimeList Library Import Service
 *
 * Imports user's manga library from MAL via:
 * 1. XML export file upload
 * 2. MAL API v2 with username (public lists only)
 *
 * Two-step process:
 * 1. Fetch: Get books from MAL and match with Trackr database (no tracking created)
 * 2. Confirm: Create trackings for selected books
 */

import { DateTime } from 'luxon'
import Book from '#models/book'
import BookTracking from '#models/book_tracking'
import { XMLParser } from 'fast-xml-parser'
import env from '#start/env'

// MAL API configuration
const MAL_API_BASE = 'https://api.myanimelist.net/v2'
const MAL_CLIENT_ID = env.get('MAL_CLIENT_ID')

// MAL status mapping to Trackr status (for XML import - numeric)
const MAL_STATUS_MAP_NUMERIC: Record<number, BookTracking['status']> = {
  1: 'reading',      // Reading
  2: 'completed',    // Completed
  3: 'on_hold',      // On-Hold
  4: 'dropped',      // Dropped
  6: 'plan_to_read', // Plan to Read
}

// MAL status mapping to Trackr status (for API import - string)
const MAL_STATUS_MAP_STRING: Record<string, BookTracking['status']> = {
  'reading': 'reading',
  'completed': 'completed',
  'on_hold': 'on_hold',
  'dropped': 'dropped',
  'plan_to_read': 'plan_to_read',
}

interface MalMangaEntry {
  manga_mangadb_id: number
  manga_title: string
  my_status: number
  my_read_chapters: number
  my_read_volumes: number
  my_score: number
  my_start_date: string
  my_finish_date: string
  my_comments?: string
}

interface MalExport {
  myanimelist: {
    myinfo?: {
      user_export_type?: number
    }
    manga?: MalMangaEntry | MalMangaEntry[]
  }
}

interface MalApiMangaEntry {
  node: {
    id: number
    title: string
  }
  list_status: {
    status: string
    is_rereading: boolean
    num_volumes_read: number
    num_chapters_read: number
    score: number
    updated_at: string
    start_date?: string
    finish_date?: string
  }
}

interface MalApiResponse {
  data: MalApiMangaEntry[]
  paging?: {
    next?: string
  }
}

// Book pending import (not yet added to library)
export interface PendingImportBook {
  bookId: number
  malId: number
  title: string
  coverImage: string | null
  status: BookTracking['status']
  currentChapter: number | null
  currentVolume: number | null
  rating: number | null
  startDate: string | null
  finishDate: string | null
  notes: string | null
}

// Result of fetching from MAL (no tracking created yet)
export interface FetchResult {
  pendingBooks: PendingImportBook[]
  notFound: number
  skipped: number
  alreadyExists: number
  errors: string[]
  details: {
    notFound: string[]
    skipped: string[]
    alreadyExists: string[]
  }
}

// Result of confirming import
export interface ConfirmResult {
  imported: number
  errors: string[]
}

export class MalImportService {
  private userId: string

  constructor(userId: string) {
    this.userId = userId
  }

  /**
   * Fetch manga library from MAL using username (API v2)
   * Does NOT create trackings - returns pending books for user review
   */
  async fetchFromUsername(username: string): Promise<FetchResult> {
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

    if (!MAL_CLIENT_ID) {
      result.errors.push('MAL API is not configured. Please contact support.')
      return result
    }

    try {
      // Fetch all manga entries from MAL API (with pagination)
      const entries = await this.fetchAllMangaFromApi(username, result)

      if (entries.length === 0 && result.errors.length === 0) {
        result.errors.push('No manga entries found in this user\'s list, or the list is private.')
        return result
      }

      // Process each entry (match with Trackr database, don't create tracking)
      for (const entry of entries) {
        await this.matchApiEntry(entry, result)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(`Failed to fetch manga list: ${errorMessage}`)
    }

    return result
  }

  /**
   * Confirm import of selected books
   * Creates trackings for the provided book IDs
   */
  async confirmImport(books: PendingImportBook[]): Promise<ConfirmResult> {
    const result: ConfirmResult = {
      imported: 0,
      errors: [],
    }

    for (const book of books) {
      try {
        // Check if already in library (safety check)
        const existingTracking = await BookTracking.query()
          .where('user_id', this.userId)
          .where('book_id', book.bookId)
          .first()

        if (existingTracking) {
          continue // Skip, already exists
        }

        // Parse dates
        const startDate = book.startDate ? this.parseDate(book.startDate) : null
        const finishDate = book.finishDate ? this.parseDate(book.finishDate) : null

        // Create tracking entry
        await BookTracking.create({
          userId: this.userId,
          bookId: book.bookId,
          status: book.status,
          currentChapter: book.currentChapter,
          currentVolume: book.currentVolume,
          rating: book.rating,
          ratedAt: book.rating ? DateTime.now() : null,
          startDate: startDate,
          finishDate: finishDate,
          notes: book.notes,
          lastReadAt: book.currentChapter || book.currentVolume ? DateTime.now() : null,
          isPinnedInLibrary: false,
        })

        result.imported++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Failed to import "${book.title}": ${errorMessage}`)
      }
    }

    return result
  }

  /**
   * Fetch all manga from MAL API with pagination
   */
  private async fetchAllMangaFromApi(username: string, result: FetchResult): Promise<MalApiMangaEntry[]> {
    const allEntries: MalApiMangaEntry[] = []
    let nextUrl: string | null = `${MAL_API_BASE}/users/${encodeURIComponent(username)}/mangalist?fields=list_status&limit=100`

    while (nextUrl) {
      try {
        const response = await fetch(nextUrl, {
          headers: {
            'X-MAL-CLIENT-ID': MAL_CLIENT_ID!,
          },
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))

          if (response.status === 404) {
            result.errors.push(`User "${username}" not found on MyAnimeList.`)
            return []
          }

          if (response.status === 403 || errorData.error === 'not_permitted') {
            result.errors.push(`Access to "${username}"'s manga list is restricted. The list must be public.`)
            return []
          }

          result.errors.push(`MAL API error: ${response.status} - ${errorData.message || 'Unknown error'}`)
          return []
        }

        const data: MalApiResponse = await response.json()
        allEntries.push(...data.data)

        // Get next page URL
        nextUrl = data.paging?.next || null

        // Rate limiting - small delay between requests
        if (nextUrl) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Failed to fetch page: ${errorMessage}`)
        break
      }
    }

    return allEntries
  }

  /**
   * Match a single API manga entry with Trackr database
   * Does NOT create tracking - adds to pendingBooks if found
   */
  private async matchApiEntry(entry: MalApiMangaEntry, result: FetchResult): Promise<void> {
    const malId = entry.node.id
    const title = entry.node.title
    const listStatus = entry.list_status

    // Validate status
    const trackrStatus = MAL_STATUS_MAP_STRING[listStatus.status]
    if (!trackrStatus) {
      result.skipped++
      result.details.skipped.push(`${title} (unknown status: ${listStatus.status})`)
      return
    }

    try {
      // Find book by MAL ID
      const book = await Book.query()
        .where('external_id', malId.toString())
        .where('data_source', 'myanimelist')
        .first()

      if (!book) {
        result.notFound++
        result.details.notFound.push(`${title} (MAL ID: ${malId})`)
        return
      }

      // Check if already in library
      const existingTracking = await BookTracking.query()
        .where('user_id', this.userId)
        .where('book_id', book.id)
        .first()

      if (existingTracking) {
        result.alreadyExists++
        result.details.alreadyExists.push(title)
        return
      }

      // Convert MAL rating (1-10) to Trackr rating (0.5-5)
      const rating = listStatus.score > 0 ? listStatus.score / 2 : null

      // Add to pending books (not yet imported)
      result.pendingBooks.push({
        bookId: book.id,
        malId: malId,
        title: book.title,
        coverImage: book.coverImage,
        status: trackrStatus,
        currentChapter: listStatus.num_chapters_read > 0 ? listStatus.num_chapters_read : null,
        currentVolume: listStatus.num_volumes_read > 0 ? listStatus.num_volumes_read : null,
        rating: rating,
        startDate: listStatus.start_date || null,
        finishDate: listStatus.finish_date || null,
        notes: null,
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(`Failed to process "${title}": ${errorMessage}`)
      result.skipped++
      result.details.skipped.push(`${title} (error: ${errorMessage})`)
    }
  }

  /**
   * Fetch from MAL XML and match with Trackr database
   * Does NOT create trackings - returns pending books for user review
   */
  async fetchFromXml(xmlContent: string): Promise<FetchResult> {
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

    try {
      // Parse XML
      const parser = new XMLParser({
        ignoreAttributes: true,
        parseTagValue: true,
      })
      const parsed: MalExport = parser.parse(xmlContent)

      // Validate export type (2 = manga)
      const exportType = parsed.myanimelist?.myinfo?.user_export_type
      if (exportType !== undefined && exportType !== 2) {
        result.errors.push('This appears to be an anime list, not a manga list. Please export your manga list from MAL.')
        return result
      }

      // Get manga entries
      let mangaEntries = parsed.myanimelist?.manga
      if (!mangaEntries) {
        result.errors.push('No manga entries found in the export file.')
        return result
      }

      // Ensure it's an array
      if (!Array.isArray(mangaEntries)) {
        mangaEntries = [mangaEntries]
      }

      // Process each manga entry
      for (const entry of mangaEntries) {
        await this.matchXmlEntry(entry, result)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error parsing XML'
      result.errors.push(`Failed to parse XML: ${errorMessage}`)
    }

    return result
  }

  /**
   * Match a single XML manga entry with Trackr database
   * Does NOT create tracking - adds to pendingBooks if found
   */
  private async matchXmlEntry(entry: MalMangaEntry, result: FetchResult): Promise<void> {
    const malId = entry.manga_mangadb_id
    const title = entry.manga_title

    // Validate status
    const trackrStatus = MAL_STATUS_MAP_NUMERIC[entry.my_status]
    if (!trackrStatus) {
      result.skipped++
      result.details.skipped.push(`${title} (unknown status: ${entry.my_status})`)
      return
    }

    try {
      // Find book by MAL ID
      const book = await Book.query()
        .where('external_id', malId.toString())
        .where('data_source', 'myanimelist')
        .first()

      if (!book) {
        result.notFound++
        result.details.notFound.push(`${title} (MAL ID: ${malId})`)
        return
      }

      // Check if already in library
      const existingTracking = await BookTracking.query()
        .where('user_id', this.userId)
        .where('book_id', book.id)
        .first()

      if (existingTracking) {
        result.alreadyExists++
        result.details.alreadyExists.push(title)
        return
      }

      // Convert MAL rating (1-10) to Trackr rating (0.5-5)
      const rating = entry.my_score > 0 ? entry.my_score / 2 : null

      // Add to pending books (not yet imported)
      result.pendingBooks.push({
        bookId: book.id,
        malId: malId,
        title: book.title,
        coverImage: book.coverImage,
        status: trackrStatus,
        currentChapter: entry.my_read_chapters > 0 ? entry.my_read_chapters : null,
        currentVolume: entry.my_read_volumes > 0 ? entry.my_read_volumes : null,
        rating: rating,
        startDate: entry.my_start_date || null,
        finishDate: entry.my_finish_date || null,
        notes: entry.my_comments || null,
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(`Failed to process "${title}": ${errorMessage}`)
      result.skipped++
      result.details.skipped.push(`${title} (error: ${errorMessage})`)
    }
  }

  /**
   * Parse MAL date format (YYYY-MM-DD or 0000-00-00)
   */
  private parseDate(dateStr: string | undefined): DateTime | null {
    if (!dateStr || dateStr === '0000-00-00' || dateStr.startsWith('0000')) {
      return null
    }

    try {
      const parsed = DateTime.fromFormat(dateStr, 'yyyy-MM-dd')
      return parsed.isValid ? parsed : null
    } catch {
      return null
    }
  }
}
