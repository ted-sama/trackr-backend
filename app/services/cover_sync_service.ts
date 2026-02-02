import drive from '@adonisjs/drive/services/main'
import env from '#start/env'
import axios from 'axios'
import { cuid } from '@adonisjs/core/helpers'
import sharp from 'sharp'
import db from '@adonisjs/lucid/services/db'

/**
 * Service for synchronizing book covers to R2 storage
 * Handles both batch sync and on-demand lazy sync
 */
export default class CoverSyncService {
  private static syncInProgress = new Set<number>()

  /**
   * Get the R2 public URL (normalized without trailing slash)
   */
  static getR2PublicUrl(): string | null {
    const r2PublicUrl = env.get('R2_PUBLIC_URL')
    if (!r2PublicUrl) return null
    return r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl
  }

  /**
   * Check if a cover URL is already on R2
   */
  static isOnR2(coverUrl: string | null): boolean {
    if (!coverUrl) return true // No cover to sync
    const r2Url = this.getR2PublicUrl()
    if (!r2Url) return true // R2 not configured
    return coverUrl.startsWith(r2Url)
  }

  /**
   * Sync a single book cover to R2 (lazy/on-demand sync)
   * This method is fire-and-forget safe - it handles its own errors
   */
  static async syncBookCover(bookId: number): Promise<void> {
    // Prevent duplicate syncs for the same book
    if (this.syncInProgress.has(bookId)) {
      return
    }

    this.syncInProgress.add(bookId)

    try {
      const r2BaseUrl = this.getR2PublicUrl()
      if (!r2BaseUrl) {
        return
      }

      // Get book data
      const book = await db
        .from('books')
        .select('id', 'title', 'cover_image', 'data_source')
        .where('id', bookId)
        .first()

      if (!book || !book.cover_image) {
        return
      }

      // Skip if already on R2
      if (book.cover_image.startsWith(r2BaseUrl)) {
        return
      }

      // Perform the sync
      const result = await this.downloadAndUpload(book, r2BaseUrl)

      if (result.success && result.newUrl) {
        await db.from('books').where('id', bookId).update({
          cover_image: result.newUrl,
          updated_at: new Date(),
        })
        console.log(`[CoverSync] Synced cover for book ${bookId}: ${book.title}`)
      }
    } catch (error) {
      console.error(`[CoverSync] Failed to sync cover for book ${bookId}:`, error)
    } finally {
      this.syncInProgress.delete(bookId)
    }
  }

  /**
   * Trigger lazy sync for a book (fire-and-forget)
   * Safe to call from controllers - won't block the response
   */
  static triggerLazySync(bookId: number, coverUrl: string | null): void {
    if (!this.isOnR2(coverUrl)) {
      // Use setImmediate to not block the current event loop tick
      setImmediate(() => {
        this.syncBookCover(bookId).catch((err) => {
          console.error(`[CoverSync] Background sync failed for book ${bookId}:`, err)
        })
      })
    }
  }

  /**
   * Download an image, convert to WebP, and upload to R2
   */
  static async downloadAndUpload(
    book: { id: number; cover_image: string; data_source: string | null },
    r2BaseUrl: string
  ): Promise<{ success: boolean; newUrl?: string; error?: string }> {
    const coverUrl = book.cover_image

    // Validate URL
    if (!coverUrl.startsWith('http://') && !coverUrl.startsWith('https://')) {
      return { success: false, error: 'Invalid URL format' }
    }

    try {
      // Download the image
      const response = await axios.get(coverUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/*',
          'Referer': this.getRefererForSource(book.data_source),
        },
        maxRedirects: 5,
      })

      const inputBuffer = Buffer.from(response.data)

      // Convert to WebP using sharp
      const webpBuffer = await sharp(inputBuffer).webp({ quality: 85 }).toBuffer()

      // Generate unique filename
      const filename = `${cuid()}.webp`
      const key = `images/book/cover/${filename}`

      // Upload to R2
      const disk = drive.use('s3')
      await disk.put(key, webpBuffer, {
        contentType: 'image/webp',
      })

      const newUrl = `${r2BaseUrl}/${key}`
      return { success: true, newUrl }
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          return { success: false, error: 'Image not found (404)' }
        }
        if (error.response?.status === 403) {
          return { success: false, error: 'Access forbidden (403)' }
        }
        return { success: false, error: `HTTP error: ${error.response?.status || error.code}` }
      }
      return { success: false, error: error.message || 'Unknown error' }
    }
  }

  /**
   * Get referer header for specific data sources
   */
  private static getRefererForSource(dataSource: string | null): string {
    switch (dataSource) {
      case 'mangadex':
        return 'https://mangadex.org/'
      case 'anilist':
        return 'https://anilist.co/'
      case 'myanimelist':
        return 'https://myanimelist.net/'
      case 'gcd':
        return 'https://www.comics.org/'
      default:
        return ''
    }
  }

  /**
   * Get count of popular books (in libraries or with reviews) that need sync
   */
  static async getPopularBooksToSyncCount(): Promise<number> {
    const r2BaseUrl = this.getR2PublicUrl()
    if (!r2BaseUrl) return 0

    const result = await db.rawQuery(
      `
      SELECT COUNT(DISTINCT b.id) as count
      FROM books b
      WHERE b.cover_image IS NOT NULL
        AND b.cover_image != ''
        AND b.cover_image NOT LIKE $1
        AND (
          EXISTS (SELECT 1 FROM library_books lb WHERE lb.book_id = b.id)
          OR EXISTS (SELECT 1 FROM book_reviews br WHERE br.book_id = b.id)
          OR b.tracking_count > 0
        )
      `,
      [`${r2BaseUrl}%`]
    )

    return Number.parseInt((result.rows as Array<{ count: string }>)[0]?.count || '0', 10)
  }
}
