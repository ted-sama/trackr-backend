import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Database from 'better-sqlite3'
import db from '@adonisjs/lucid/services/db'
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page } from 'puppeteer'
import { createWriteStream, existsSync, mkdirSync, unlinkSync, createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { join } from 'node:path'

// Enable stealth plugin to bypass Cloudflare
const puppeteer = puppeteerExtra.default ?? puppeteerExtra
puppeteer.use(StealthPlugin())

export default class ImportGcd extends BaseCommand {
  static commandName = 'import:gcd'
  static description = 'Import Grand Comics Database (GCD) comics into Trackr database'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({ description: 'Limit number of comics to import (for testing)' })
  declare limit?: number

  @flags.boolean({ description: 'Scrape cover images from GCD website after import' })
  declare scrapeCovers: boolean

  @flags.boolean({ description: 'Only scrape covers (skip import)' })
  declare coversOnly: boolean

  @flags.number({ description: 'Delay between scraping requests in ms (default: 3000)' })
  declare delay: number

  @flags.number({ description: 'Skip first N books when scraping covers (for resuming)' })
  declare skip: number

  @flags.string({
    description: 'URL to download GCD database from (direct link to .gz or .db file)',
  })
  declare dbUrl: string

  private allowedPublishers = [54, 78, 709, 512, 1977, 2547, 865, 370, 17792, 674]
  private gcdDbPath = process.env.GCD_DB_PATH || '/tmp/gcd-data/gcd.db'
  private gcdDownloadDir = process.env.GCD_DOWNLOAD_DIR || '/tmp/gcd-data'
  private browser: Browser | null = null
  private scrapeDelay = 3000 // 3 seconds between requests

  async run() {
    const limitNumber = this.limit
    this.scrapeDelay = this.delay || 3000

    // If covers-only mode, skip import and just scrape covers
    if (this.coversOnly) {
      this.logger.info('Cover scraping only mode (skipping import)...')
      await this.scrapeGcdCovers(limitNumber)
      return
    }

    // Download database from URL if provided
    if (this.dbUrl) {
      await this.downloadFromUrl(this.dbUrl)
    }

    // Check if database exists
    if (!existsSync(this.gcdDbPath)) {
      this.logger.error(`GCD database not found at ${this.gcdDbPath}`)
      this.logger.info('Options:')
      this.logger.info('  1. Transfer the DB via SCP: scp gcd.db user@vps:/tmp/gcd-data/')
      this.logger.info('  2. Use --db-url to download from a direct URL')
      this.logger.info('  3. Set GCD_DB_PATH env var to point to an existing DB')
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

      // Dédupliquer les noms de comics (ajouter l'année si plusieurs ont le même nom)
      await this.deduplicateComicNames()

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
        -- Only keep original series (ongoing, limited, miniseries, one-shots)
        -- This filters out trade paperbacks, hardcovers, collected editions, etc.
        AND (
          LOWER(s.publishing_format) LIKE '%ongoing%'
          OR LOWER(s.publishing_format) LIKE '%one-shot%'
          OR LOWER(s.publishing_format) LIKE '%one shot%'
          OR LOWER(s.publishing_format) LIKE '%oneshot%'
          OR LOWER(s.publishing_format) LIKE '%limited series%'
          OR LOWER(s.publishing_format) LIKE '%miniseries%'
          OR LOWER(s.publishing_format) LIKE '%mini-series%'
        )
        -- Exclude compilations/reprints
        AND s.name NOT LIKE '%Masterwork%'
        AND s.name NOT LIKE '%Essential%'
        AND s.name NOT LIKE '%Omnibus%'
        AND s.name NOT LIKE '%Epic Collection%'
        AND s.name NOT LIKE '%Showcase Presents%'
        AND s.name NOT LIKE '%Archives%'
        AND s.name NOT LIKE '%Ultimate Collection%'
        AND s.name NOT LIKE '%Platinum%'
        -- Exclude magazines/digests
        AND s.name NOT LIKE '%Magazine%'
        AND s.name NOT LIKE '%Digest%'
        -- Exclude movie adaptations
        AND s.name NOT LIKE '%Movie%'
        AND s.name NOT LIKE '%Adaptation%'
        AND s.name NOT LIKE '%Motion Picture%'
        AND s.name NOT LIKE '%Official Comic%'
        -- Exclude licensed/kids content
        AND s.name NOT LIKE 'Disney%'
        AND s.name NOT LIKE '%ALF%'
        AND s.name NOT LIKE 'Dennis the Menace%'
        AND s.name NOT LIKE 'Star Trek%'
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

        // Si le comic est en cours (is_current ou pas de year_ended), chapters = null
        const isOngoing = comic.is_current || !comic.year_ended
        const [insertResult] = await db
          .table('books')
          .insert({
            title: comic.name,
            type: 'comic',
            release_year: comic.year_began,
            end_year: isOngoing ? null : comic.year_ended,
            description: null,
            status: isOngoing ? 'ongoing' : 'completed',
            chapters: isOngoing ? null : comic.issue_count,
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
      // GCD shows covers in a flex grid - we want the first one
      const coverUrl = await page
        .$$eval('img[src*="/covers/"], img.cover_img, .cover img', (imgs) => {
          const first = imgs[0]
          return first ? first.getAttribute('src') : null
        })
        .catch(() => null)

      // If no direct cover, try finding any cover-like image (first match)
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
            .$$eval('img[src*="/covers/"], img.cover_img, .cover img', (imgs) => {
              const first = imgs[0]
              return first ? first.getAttribute('src') : null
            })
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

  /**
   * Download the GCD SQLite database from a direct URL
   * (e.g., from S3, your own server, or any direct download link)
   */
  private async downloadFromUrl(url: string) {
    this.logger.info(`📥 Downloading GCD database from ${url}...`)

    // Create download directory if it doesn't exist
    if (!existsSync(this.gcdDownloadDir)) {
      mkdirSync(this.gcdDownloadDir, { recursive: true })
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    // Determine filename from content-disposition or URL
    const contentDisposition = response.headers.get('content-disposition')
    let filename = 'gcd.db'
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (match) {
        filename = match[1].replace(/['"]/g, '')
      }
    } else if (url.includes('.')) {
      filename = url.split('/').pop()?.split('?')[0] || filename
    }

    const downloadPath = join(this.gcdDownloadDir, filename)
    const fileStream = createWriteStream(downloadPath)

    // @ts-ignore - response.body is a ReadableStream
    await pipeline(response.body, fileStream)

    this.logger.success(`Downloaded to ${downloadPath}`)

    // Decompress if needed
    if (filename.endsWith('.gz')) {
      this.logger.info('Decompressing database...')
      const decompressedPath = downloadPath.replace('.gz', '')

      await pipeline(
        createReadStream(downloadPath),
        createGunzip(),
        createWriteStream(decompressedPath)
      )

      this.gcdDbPath = decompressedPath

      // Clean up compressed file
      unlinkSync(downloadPath)
      this.logger.success(`Decompressed to ${this.gcdDbPath}`)
    } else {
      this.gcdDbPath = downloadPath
    }

    this.logger.success('GCD database download complete!')
  }

  /**
   * Déduplique les noms de comics en ajoutant l'année au titre
   * pour les comics qui partagent le même nom
   * Ex: "The Amazing Spider-Man" -> "The Amazing Spider-Man (2022)"
   */
  private async deduplicateComicNames() {
    this.logger.info('Checking for duplicate comic names...')

    // Trouver tous les titres qui apparaissent plus d'une fois
    const duplicates = await db
      .from('books')
      .select('title')
      .where('type', 'comic')
      .where('data_source', 'gcd')
      .groupBy('title')
      .havingRaw('COUNT(*) > 1')

    if (duplicates.length === 0) {
      this.logger.info('No duplicate comic names found')
      return
    }

    this.logger.info(`Found ${duplicates.length} duplicate titles to fix`)

    let updated = 0

    for (const dup of duplicates) {
      // Récupérer tous les comics avec ce titre
      const comics = await db
        .from('books')
        .select('id', 'title', 'release_year')
        .where('type', 'comic')
        .where('data_source', 'gcd')
        .where('title', dup.title)
        .orderBy('release_year', 'asc')

      for (const comic of comics) {
        if (comic.release_year) {
          // Ne pas ajouter l'année si elle est déjà dans le titre
          if (!comic.title.includes(`(${comic.release_year})`)) {
            const newTitle = `${comic.title} (${comic.release_year})`
            await db.from('books').where('id', comic.id).update({
              title: newTitle,
              updated_at: new Date(),
            })
            updated++
          }
        }
      }
    }

    this.logger.success(`Updated ${updated} comic titles with year disambiguation`)
  }
}
