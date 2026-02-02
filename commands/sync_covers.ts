import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import env from '#start/env'
import axios from 'axios'
import { cuid } from '@adonisjs/core/helpers'
import sharp from 'sharp'

const DEFAULT_DELAY_MS = 500

export default class SyncCovers extends BaseCommand {
  static commandName = 'sync:covers'
  static description =
    'Download external cover images, convert to WebP, and upload them to R2 storage'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({ description: 'Maximum number of covers to process' })
  declare limit?: number

  @flags.string({ description: 'Filter by data source (anilist, myanimelist, mangadex, gcd)' })
  declare dataSource?: string

  @flags.number({ description: 'Delay between downloads in ms (default: 500)' })
  declare delay?: number

  @flags.number({ description: 'Skip first N books (for resuming)' })
  declare skip?: number

  @flags.boolean({ description: 'Dry run mode - show what would be done without making changes' })
  declare dryRun: boolean

  @flags.boolean({
    description: 'Only sync popular books (in libraries, with reviews, or tracked)',
    alias: 'p',
  })
  declare popularOnly: boolean

  private downloadDelay = DEFAULT_DELAY_MS

  async run() {
    this.downloadDelay = this.delay ?? DEFAULT_DELAY_MS

    const r2PublicUrl = env.get('R2_PUBLIC_URL')
    if (!r2PublicUrl) {
      this.logger.error('R2_PUBLIC_URL environment variable is not set')
      return
    }

    // Normalize R2 URL for comparison
    const normalizedR2Url = r2PublicUrl.endsWith('/') ? r2PublicUrl.slice(0, -1) : r2PublicUrl

    if (this.dryRun) {
      this.logger.info('DRY RUN MODE - No changes will be made')
    }

    this.logger.info('Starting cover sync to R2 (WebP conversion enabled)...')
    this.logger.info(`Download delay: ${this.downloadDelay}ms`)

    // Build query for books with external cover URLs
    const query = db
      .from('books')
      .select('id', 'title', 'cover_image', 'data_source')
      .whereNotNull('cover_image')
      .whereNot('cover_image', '')
      // Exclude covers already on R2
      .whereNot('cover_image', 'like', `${normalizedR2Url}%`)
      .orderBy('id', 'asc')

    // Filter for popular books only
    if (this.popularOnly) {
      query.where((builder) => {
        builder
          .whereExists((subQuery) => {
            subQuery.from('library_books as lb').whereRaw('lb.book_id = books.id')
          })
          .orWhereExists((subQuery) => {
            subQuery.from('book_reviews as br').whereRaw('br.book_id = books.id')
          })
          .orWhere('tracking_count', '>', 0)
      })
      this.logger.info('Filtering: popular books only (in libraries, with reviews, or tracked)')
    }

    if (this.dataSource) {
      query.where('data_source', this.dataSource)
      this.logger.info(`Filtering by data source: ${this.dataSource}`)
    }

    if (this.skip) {
      query.offset(this.skip)
      this.logger.info(`Skipping first ${this.skip} books`)
    }

    if (this.limit) {
      query.limit(this.limit)
      this.logger.info(`Limiting to ${this.limit} books`)
    }

    const books = await query

    this.logger.info(`Found ${books.length} books with external covers to sync`)

    if (books.length === 0) {
      this.logger.success('All covers are already synced to R2!')
      return
    }

    let synced = 0
    let failed = 0
    let skipped = 0

    for (const book of books) {
      try {
        const result = await this.syncCover(book, normalizedR2Url)

        if (result === 'synced') {
          synced++
          this.logger.info(`[${synced}/${books.length}] ${book.title}`)
        } else if (result === 'skipped') {
          skipped++
        } else {
          failed++
          this.logger.warning(`[${synced + failed}/${books.length}] ${book.title}: ${result}`)
        }

        // Progress update every 10 books
        const processed = synced + failed + skipped
        if (processed % 10 === 0) {
          const progress = Math.round((processed / books.length) * 100)
          this.logger.info(
            `Progress: ${progress}% | synced: ${synced}, failed: ${failed}, skipped: ${skipped}`
          )
        }

        // Delay between downloads
        if (result === 'synced') {
          await this.sleep(this.downloadDelay)
        }
      } catch (error: any) {
        failed++
        this.logger.error(`Failed to sync cover for "${book.title}": ${error.message}`)
      }
    }

    this.logger.success(
      `Cover sync complete: ${synced} synced, ${failed} failed, ${skipped} skipped`
    )
  }

  private async syncCover(
    book: { id: number; title: string; cover_image: string; data_source: string | null },
    r2BaseUrl: string
  ): Promise<'synced' | 'skipped' | string> {
    const coverUrl = book.cover_image

    // Skip if already on R2
    if (coverUrl.startsWith(r2BaseUrl)) {
      return 'skipped'
    }

    // Skip invalid URLs
    if (!coverUrl.startsWith('http://') && !coverUrl.startsWith('https://')) {
      return 'Invalid URL format'
    }

    if (this.dryRun) {
      this.logger.info(`[DRY RUN] Would sync: ${book.title} <- ${coverUrl}`)
      return 'synced'
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

      // Generate unique filename (always .webp now)
      const filename = `${cuid()}.webp`
      const key = `images/book/cover/${filename}`

      // Upload to R2
      const disk = drive.use('s3')
      await disk.put(key, webpBuffer, {
        contentType: 'image/webp',
      })

      // Build new URL
      const newUrl = `${r2BaseUrl}/${key}`

      // Update database
      await db.from('books').where('id', book.id).update({
        cover_image: newUrl,
        updated_at: new Date(),
      })

      return 'synced'
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          return 'Image not found (404)'
        }
        if (error.response?.status === 403) {
          return 'Access forbidden (403)'
        }
        if (error.code === 'ECONNREFUSED') {
          return 'Connection refused'
        }
        if (error.code === 'ETIMEDOUT') {
          return 'Request timeout'
        }
        return `HTTP error: ${error.response?.status || error.code || 'unknown'}`
      }
      return error.message || 'Unknown error'
    }
  }

  private getRefererForSource(dataSource: string | null): string {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
