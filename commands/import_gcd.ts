import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Database from 'better-sqlite3'
import db from '@adonisjs/lucid/services/db'
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page } from 'puppeteer'

// Enable stealth plugin to bypass Cloudflare
const puppeteer = puppeteerExtra.default ?? puppeteerExtra
puppeteer.use(StealthPlugin())

export default class ImportGcd extends BaseCommand {
  static commandName = 'import:gcd'
  static description = 'Import Grand Comics Database (GCD) comics into Trackr database'

  static options: CommandOptions = {
    startApp: true,
  }

  @args.string({ description: 'Limit number of comics to import (for testing)' })
  declare limit?: string

  @flags.boolean({ description: 'Scrape cover images from GCD website after import' })
  declare scrapeCovers: boolean

  @flags.boolean({ description: 'Only scrape covers (skip import)' })
  declare coversOnly: boolean

  @flags.number({ description: 'Delay between scraping requests in ms (default: 3000)' })
  declare delay: number

  @flags.number({ description: 'Skip first N books when scraping covers (for resuming)' })
  declare skip: number

  private allowedPublishers = [54, 78, 709, 512, 1977, 2547, 865, 370, 17792, 674]
  private gcdDbPath = process.env.GCD_DB_PATH || '/comics-dump/gcd.db'
  private browser: Browser | null = null
  private scrapeDelay = 3000 // 3 seconds between requests

  async run() {
    const limitNumber = this.limit ? Number.parseInt(this.limit) : undefined
    this.scrapeDelay = this.delay || 3000

    // If covers-only mode, skip import and just scrape covers
    if (this.coversOnly) {
      this.logger.info('Cover scraping only mode (skipping import)...')
      await this.scrapeGcdCovers(limitNumber)
      return
    }

    if (limitNumber) {
      this.logger.info(`Starting GCD import (limited to ${limitNumber} comics)...`)
    } else {
      this.logger.info('Starting GCD import...')
    }

    const gcdDb = new Database(this.gcdDbPath, { readonly: true })

    try {
      await this.importPublishers(gcdDb)
      await this.importComics(gcdDb, limitNumber)

      this.logger.success('GCD import completed successfully!')

      // Optionally scrape covers after import
      if (this.scrapeCovers) {
        this.logger.info('Starting cover scraping from GCD...')
        await this.scrapeGcdCovers(limitNumber)
      } else {
        this.logger.info(
          'Note: Use --scrape-covers flag to fetch cover images from GCD, or use "node ace import:gcdcovers" for Comic Vine API'
        )
      }
    } catch (error) {
      this.logger.error('Import failed:', error)
      throw error
    } finally {
      gcdDb.close()
    }
  }

  private async importPublishers(gcdDb: Database.Database) {
    this.logger.info('Importing publishers...')

    const publishers = gcdDb
      .prepare(
        `
      SELECT id, name
      FROM gcd_publisher
      WHERE id IN (${this.allowedPublishers.join(',')})
    `
      )
      .all() as Array<{ id: number; name: string }>

    for (const pub of publishers) {
      const existing = await db
        .from('publishers')
        .where('data_source', 'gcd')
        .where('external_id', pub.id)
        .first()

      if (existing) {
        await db
          .from('publishers')
          .where('id', existing.id)
          .update({ name: pub.name, updated_at: new Date() })
      } else {
        await db.table('publishers').insert({
          name: pub.name,
          data_source: 'gcd',
          external_id: pub.id,
          created_at: new Date(),
          updated_at: new Date(),
        })
      }
    }

    this.logger.success(`Imported ${publishers.length} publishers`)
  }

  private async importComics(gcdDb: Database.Database, limit?: number) {
    this.logger.info('Importing comics...')

    const query = `
      SELECT
        s.id,
        s.name,
        s.year_began,
        s.year_ended,
        s.is_current,
        s.issue_count,
        s.publisher_id
      FROM gcd_series s
      WHERE s.deleted = 0
        AND s.is_comics_publication = 1
        AND s.year_began >= 1980
        AND s.issue_count > 1
        AND s.publisher_id IN (${this.allowedPublishers.join(',')})
      ORDER BY s.id
      ${limit ? `LIMIT ${limit}` : ''}
    `

    const comics = gcdDb.prepare(query).all() as Array<{
      id: number
      name: string
      year_began: number
      year_ended: number | null
      is_current: number
      issue_count: number
      publisher_id: number
    }>

    this.logger.info(`Found ${comics.length} comics to import`)

    let imported = 0
    let skipped = 0

    for (const comic of comics) {
      try {
        const existing = await db
          .from('books')
          .where('data_source', 'gcd')
          .where('external_id', comic.id)
          .first()

        if (existing) {
          skipped++
          continue
        }

        const [insertResult] = await db
          .table('books')
          .insert({
            title: comic.name,
            type: 'comic',
            release_year: comic.year_began,
            end_year: comic.is_current ? null : comic.year_ended,
            description: null,
            status: comic.is_current ? 'ongoing' : 'completed',
            chapters: comic.issue_count,
            data_source: 'gcd',
            external_id: comic.id,
            nsfw: false,
            rating_count: 0,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning('id')

        const bookId = insertResult.id

        await this.linkPublishers(comic.publisher_id, bookId)

        imported++

        if (imported % 100 === 0) {
          this.logger.info(`Progress: ${imported} imported, ${skipped} skipped`)
        }
      } catch (error) {
        this.logger.error(`Failed to import comic ${comic.id}:`, error)
      }
    }

    this.logger.success(`Import complete: ${imported} imported, ${skipped} skipped`)
  }

  private async linkPublishers(publisherIdStr: number, bookId: number) {
    const publisherIds = publisherIdStr.toString().includes(';')
      ? publisherIdStr
          .toString()
          .split(';')
          .map((id) => Number.parseInt(id.trim()))
      : [publisherIdStr]

    for (const pubId of publisherIds) {
      const publisher = await db
        .from('publishers')
        .where('data_source', 'gcd')
        .where('external_id', pubId)
        .first()

      if (publisher) {
        const existingLink = await db
          .from('book_publishers')
          .where('book_id', bookId)
          .where('publisher_id', publisher.id)
          .first()

        if (!existingLink) {
          await db.table('book_publishers').insert({
            book_id: bookId,
            publisher_id: publisher.id,
            created_at: new Date(),
            updated_at: new Date(),
          })
        }
      }
    }
  }

  /**
   * Scrape cover images directly from GCD website using Puppeteer Stealth
   * This bypasses Cloudflare protection
   */
  private async scrapeGcdCovers(limit?: number) {
    this.logger.info('🕵️ Starting GCD cover scraping with Cloudflare bypass...')
    this.logger.info(`Request delay: ${this.scrapeDelay}ms`)

    // Get books without covers
    const query = db
      .from('books')
      .select('id', 'title', 'external_id', 'cover_image')
      .where('data_source', 'gcd')
      .where('type', 'comic')
      .whereNull('cover_image')
      .orderBy('id', 'asc')

    if (this.skip) {
      query.offset(this.skip)
      this.logger.info(`Skipping first ${this.skip} books (resume mode)`)
    }

    if (limit) {
      query.limit(limit)
    }

    const books = await query

    this.logger.info(`Found ${books.length} books without covers`)

    if (books.length === 0) {
      this.logger.success('All books already have covers!')
      return
    }

    // Estimate time
    const estimatedSeconds = (books.length * this.scrapeDelay) / 1000
    const estimatedMinutes = Math.round(estimatedSeconds / 60)
    if (estimatedMinutes > 2) {
      this.logger.info(`⏱️ Estimated time: ~${estimatedMinutes} minutes`)
    }

    try {
      await this.initBrowser()

      let updated = 0
      let failed = 0

      for (const book of books) {
        try {
          const coverUrl = await this.scrapeSeriesCover(book.external_id)

          if (coverUrl) {
            await db.from('books').where('id', book.id).update({
              cover_image: coverUrl,
              updated_at: new Date(),
            })

            updated++
            this.logger.info(`✓ [${updated}/${books.length}] ${book.title}`)
          } else {
            failed++
            this.logger.warning(
              `⚠ [${updated + failed}/${books.length}] ${book.title}: No cover found`
            )
          }

          // Progress update every 10 books
          const processed = updated + failed
          if (processed % 10 === 0) {
            const progress = Math.round((processed / books.length) * 100)
            this.logger.info(`Progress: ${progress}% | ${updated} updated, ${failed} failed`)
          }

          // Delay between requests
          await this.sleep(this.scrapeDelay)
        } catch (error) {
          failed++
          this.logger.error(`Failed to scrape cover for "${book.title}":`, error)
        }
      }

      this.logger.success(`Cover scraping complete: ${updated} updated, ${failed} failed`)
    } finally {
      await this.closeBrowser()
    }
  }

  /**
   * Initialize Puppeteer browser with stealth plugin
   */
  private async initBrowser() {
    this.logger.info('🚀 Launching browser with stealth mode...')

    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    })

    this.logger.success('Browser launched successfully')
  }

  /**
   * Close the browser instance
   */
  private async closeBrowser() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.logger.info('Browser closed')
    }
  }

  /**
   * Scrape cover image from a GCD series page
   */
  private async scrapeSeriesCover(gcdSeriesId: number): Promise<string | null> {
    if (!this.browser) {
      throw new Error('Browser not initialized')
    }

    const page: Page = await this.browser.newPage()

    try {
      // Set a realistic user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 })

      // Navigate to GCD series page
      const url = `https://www.comics.org/series/${gcdSeriesId}/`
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      // Wait for potential Cloudflare challenge
      await this.sleep(2000)

      // Try to find cover image on the series page
      // GCD typically shows covers in the issue list or as a series thumbnail
      const coverUrl = await page
        .$eval('img[src*="/covers/"], img.cover_img, .cover img', (img) => img.getAttribute('src'))
        .catch(() => null)

      // If no direct cover, try finding any cover-like image
      const fallbackCoverUrl =
        coverUrl ||
        (await page
          .$$eval('img', (imgs) => {
            for (const img of imgs) {
              const src = img.getAttribute('src') || ''
              if (
                src.includes('/covers/') ||
                src.includes('/w100/') ||
                src.includes('/w200/') ||
                src.includes('/w400/')
              ) {
                return src
              }
            }
            return null
          })
          .catch(() => null))

      // If no cover on series page, try the first issue page
      if (!fallbackCoverUrl) {
        const firstIssueUrl = await page
          .$eval('a[href*="/issue/"]', (a) => a.getAttribute('href'))
          .catch(() => null)

        if (firstIssueUrl) {
          const fullUrl = firstIssueUrl.startsWith('http')
            ? firstIssueUrl
            : `https://www.comics.org${firstIssueUrl}`

          await page.goto(fullUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000,
          })

          await this.sleep(1500)

          const issueCoverUrl = await page
            .$eval('img[src*="/covers/"], img.cover_img, .cover img', (img) =>
              img.getAttribute('src')
            )
            .catch(() => null)

          return issueCoverUrl
        }
      }

      return fallbackCoverUrl
    } catch (error) {
      this.logger.error(`Error scraping series ${gcdSeriesId}:`, error)
      return null
    } finally {
      await page.close()
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
