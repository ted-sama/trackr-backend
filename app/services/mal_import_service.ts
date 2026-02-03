/**
 * MyAnimeList Library Import Service
 * 
 * Imports user's manga library from MAL via:
 * 1. XML export file upload
 * 2. MAL API v2 with username (public lists only)
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

export interface ImportResult {
  imported: number
  notFound: number
  skipped: number
  alreadyExists: number
  errors: string[]
  details: {
    imported: string[]
    notFound: string[]
    skipped: string[]
    alreadyExists: string[]
  }
}

export class MalImportService {
  private userId: string

  constructor(userId: string) {
    this.userId = userId
  }

  /**
   * Import manga library from MAL using username (API v2)
   */
  async importFromUsername(username: string): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      notFound: 0,
      skipped: 0,
      alreadyExists: 0,
      errors: [],
      details: {
        imported: [],
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

      // Process each entry
      for (const entry of entries) {
        await this.processApiEntry(entry, result)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(`Failed to fetch manga list: ${errorMessage}`)
    }

    return result
  }

  /**
   * Fetch all manga from MAL API with pagination
   */
  private async fetchAllMangaFromApi(username: string, result: ImportResult): Promise<MalApiMangaEntry[]> {
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
   * Process a single API manga entry
   */
  private async processApiEntry(entry: MalApiMangaEntry, result: ImportResult): Promise<void> {
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

      // Parse dates
      const startDate = this.parseDate(listStatus.start_date)
      const finishDate = this.parseDate(listStatus.finish_date)

      // Create tracking entry
      await BookTracking.create({
        userId: this.userId,
        bookId: book.id,
        status: trackrStatus,
        currentChapter: listStatus.num_chapters_read > 0 ? listStatus.num_chapters_read : null,
        currentVolume: listStatus.num_volumes_read > 0 ? listStatus.num_volumes_read : null,
        rating: listStatus.score > 0 ? listStatus.score : null,
        ratedAt: listStatus.score > 0 ? DateTime.now() : null,
        startDate: startDate,
        finishDate: finishDate,
        notes: null,
        lastReadAt: listStatus.num_chapters_read > 0 || listStatus.num_volumes_read > 0 ? DateTime.now() : null,
        isPinnedInLibrary: false,
      })

      result.imported++
      result.details.imported.push(title)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(`Failed to import "${title}": ${errorMessage}`)
      result.skipped++
      result.details.skipped.push(`${title} (error: ${errorMessage})`)
    }
  }

  /**
   * Parse MAL XML and import manga entries into user's library
   */
  async importFromXml(xmlContent: string): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      notFound: 0,
      skipped: 0,
      alreadyExists: 0,
      errors: [],
      details: {
        imported: [],
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
        await this.processXmlEntry(entry, result)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error parsing XML'
      result.errors.push(`Failed to parse XML: ${errorMessage}`)
    }

    return result
  }

  /**
   * Process a single XML manga entry
   */
  private async processXmlEntry(entry: MalMangaEntry, result: ImportResult): Promise<void> {
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

      // Parse dates
      const startDate = this.parseDate(entry.my_start_date)
      const finishDate = this.parseDate(entry.my_finish_date)

      // Create tracking entry
      await BookTracking.create({
        userId: this.userId,
        bookId: book.id,
        status: trackrStatus,
        currentChapter: entry.my_read_chapters > 0 ? entry.my_read_chapters : null,
        currentVolume: entry.my_read_volumes > 0 ? entry.my_read_volumes : null,
        rating: entry.my_score > 0 ? entry.my_score : null,
        ratedAt: entry.my_score > 0 ? DateTime.now() : null,
        startDate: startDate,
        finishDate: finishDate,
        notes: entry.my_comments || null,
        lastReadAt: entry.my_read_chapters > 0 || entry.my_read_volumes > 0 ? DateTime.now() : null,
        isPinnedInLibrary: false,
      })

      result.imported++
      result.details.imported.push(title)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(`Failed to import "${title}": ${errorMessage}`)
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
