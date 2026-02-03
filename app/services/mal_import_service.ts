/**
 * MyAnimeList Library Import Service
 * 
 * Parses MAL XML export files and imports user's manga library into Trackr.
 */

import { DateTime } from 'luxon'
import Book from '#models/book'
import BookTracking from '#models/book_tracking'
import { XMLParser } from 'fast-xml-parser'

// MAL status mapping to Trackr status
const MAL_STATUS_MAP: Record<number, BookTracking['status']> = {
  1: 'reading',      // Reading
  2: 'completed',    // Completed
  3: 'on_hold',      // On-Hold
  4: 'dropped',      // Dropped
  6: 'plan_to_read', // Plan to Read
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
        await this.processEntry(entry, result)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error parsing XML'
      result.errors.push(`Failed to parse XML: ${errorMessage}`)
    }

    return result
  }

  /**
   * Process a single manga entry
   */
  private async processEntry(entry: MalMangaEntry, result: ImportResult): Promise<void> {
    const malId = entry.manga_mangadb_id
    const title = entry.manga_title

    // Validate status
    const trackrStatus = MAL_STATUS_MAP[entry.my_status]
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
  private parseDate(dateStr: string): DateTime | null {
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
