import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
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

  @flags.boolean({
    description: 'Auto-download latest GCD database dump (requires GCD_EMAIL and GCD_PASSWORD)',
  })
  declare autoDownload: boolean

  @flags.boolean({ description: 'Update existing comics (upsert mode) instead of skipping' })
  declare update: boolean

  @flags.boolean({
    description: 'Force re-scrape covers even if already present (replace with Issue #1)',
  })
  declare forceCovers: boolean

  private allowedPublishers = [54, 78, 709, 512, 1977, 2547, 865, 370, 17792, 674]
  private gcdDbPath = process.env.GCD_DB_PATH || join(process.cwd(), 'storage/gcd/gcd.db')
  private gcdDownloadDir = process.env.GCD_DOWNLOAD_DIR || join(process.cwd(), 'storage/gcd')
  private browser: Browser | null = null
  private scrapeDelay = 3000 // 3 seconds between requests
  private gcdDb: Database.Database | null = null

  async run() {
    const limitNumber = this.limit
    this.scrapeDelay = this.delay || 3000

    // If covers-only mode, skip import and just scrape covers
    if (this.coversOnly) {
      this.logger.info('Cover scraping only mode (skipping import)...')
      // Need to open GCD database for Issue #1 lookup
      if (existsSync(this.gcdDbPath)) {
        this.gcdDb = new Database(this.gcdDbPath, { readonly: true })
      }
      try {
        await this.scrapeGcdCovers(limitNumber)
      } finally {
        if (this.gcdDb) {
          this.gcdDb.close()
          this.gcdDb = null
        }
      }
      return
    }

    // Auto-download from GCD website if requested
    if (this.autoDownload) {
      this.logger.info('Auto-downloading latest GCD database...')
      await this.downloadGcdDump()
    }

    // Download database from URL if provided
    if (this.dbUrl) {
      await this.downloadFromUrl(this.dbUrl)
    }

    // Check if database exists
    if (!existsSync(this.gcdDbPath)) {
      this.logger.error(`GCD database not found at ${this.gcdDbPath}`)
      this.logger.info('Options:')
      this.logger.info('  1. Transfer the DB via SCP: scp gcd.db server:storage/gcd/')
      this.logger.info('  2. Use --db-url to download from a direct URL')
      this.logger.info('  3. Use --auto-download to login and download from GCD website')
      this.logger.info('  4. Set GCD_DB_PATH env var to point to an existing DB')
      return
    }

    if (limitNumber) {
      this.logger.info(`Starting GCD import (limited to ${limitNumber} comics)...`)
    } else {
      this.logger.info('Starting GCD import...')
    }

    if (this.update) {
      this.logger.info('Update mode enabled - existing comics will be updated')
    }

    this.gcdDb = new Database(this.gcdDbPath, { readonly: true })

    try {
      await this.importPublishers(this.gcdDb)
      await this.importComics(this.gcdDb, limitNumber)

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
      this.gcdDb.close()
      this.gcdDb = null
    }
  }

  /**
   * Auto-download the latest GCD database dump by logging into comics.org
   * Requires GCD_EMAIL and GCD_PASSWORD environment variables
   */
  private async downloadGcdDump(): Promise<void> {
    const email = env.get('GCD_EMAIL')
    const password = env.get('GCD_PASSWORD')

    if (!email || !password) {
      throw new Error(
        'GCD_EMAIL and GCD_PASSWORD environment variables are required for auto-download. Create a free account at https://www.comics.org/'
      )
    }

    await this.initBrowser()

    if (!this.browser) {
      throw new Error('Failed to initialize browser')
    }

    const page = await this.browser.newPage()

    try {
      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )

      this.logger.info('Logging into GCD website...')

      // 1. Navigate to login page
      await page.goto('https://www.comics.org/accounts/login/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })

      // Wait for page to stabilize
      await this.sleep(3000)

      // 2. Fill login form using keyboard input
      this.logger.info('Filling login form...')

      // Focus on username field and type
      await page.focus('input[type="text"]')
      await page.keyboard.type(email, { delay: 50 })

      // Tab to password and type
      await page.keyboard.press('Tab')
      await page.keyboard.type(password, { delay: 50 })

      this.logger.info('Credentials entered, submitting...')

      // 3. Submit with Enter key
      await page.keyboard.press('Enter')

      // Wait for navigation
      await this.sleep(5000)

      await this.sleep(2000)

      // Check if login was successful (profile page or logout link present)
      const currentUrl = page.url()
      const isLoggedIn =
        currentUrl.includes('/accounts/profile/') ||
        currentUrl.includes('/download/') ||
        (await page.$('a[href*="logout"]')) !== null

      if (!isLoggedIn && currentUrl.includes('/accounts/login')) {
        this.logger.error(`Login check failed. Current URL: ${currentUrl}`)

        // Save screenshot for debugging
        const screenshotPath = join(this.gcdDownloadDir, 'login-debug.png')
        if (!existsSync(this.gcdDownloadDir)) {
          mkdirSync(this.gcdDownloadDir, { recursive: true })
        }
        await page.screenshot({ path: screenshotPath, fullPage: true })
        this.logger.info(`Debug screenshot saved to: ${screenshotPath}`)

        // Check for error messages on the page
        const errorMsg = await page
          .$eval('.errorlist, .error, .alert-danger', (el) => el.textContent)
          .catch(() => null)
        if (errorMsg) {
          this.logger.error(`Login error message: ${errorMsg.trim()}`)
        }

        throw new Error('Login failed - please check your GCD_EMAIL and GCD_PASSWORD')
      }

      this.logger.success('Logged in successfully')

      // 4. Navigate to download page
      this.logger.info('Navigating to download page...')
      await page.goto('https://www.comics.org/download/', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      })

      await this.sleep(2000)

      // 5. Accept the license terms checkbox
      this.logger.info('Accepting license terms...')
      const checkbox = await page.$('input[type="checkbox"]')
      if (checkbox) {
        await checkbox.click()
        await this.sleep(2000)
      }

      // Get cookies for authenticated download
      const cookies = await page.cookies()
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

      // Try to download via direct button click (using Puppeteer's download handling)
      this.logger.info('Trying download via direct button click...')
      const directDownloaded = await this.clickDownloadButton(page)
      if (directDownloaded) {
        return
      }

      // Fallback: Try form submission via fetch
      this.logger.info('Trying download via form submission...')
      const formDownloaded = await this.submitDownloadForm(page, cookieHeader)
      if (formDownloaded) {
        return
      }

      // Take screenshot after checkbox
      const afterCheckbox = join(this.gcdDownloadDir, 'download-after-checkbox.png')
      await page.screenshot({ path: afterCheckbox, fullPage: true })

      // 6. Find SQLite download link - search all clickable elements
      this.logger.info('Looking for download links...')

      const downloadUrl = await page.evaluate(() => {
        // First try: Look for links/buttons with download text
        const allElements = document.querySelectorAll(
          'a, button, input[type="button"], input[type="submit"]'
        )
        for (const el of allElements) {
          const text = (el.textContent || '').toLowerCase()
          const href = el.getAttribute('href') || ''
          const value = el.getAttribute('value') || ''

          // SQLite is preferred
          if (text.includes('sqlite') || value.includes('sqlite')) {
            if (href) return href.startsWith('http') ? href : `https://www.comics.org${href}`
          }
        }

        // Second try: MySQL dump
        for (const el of allElements) {
          const text = (el.textContent || '').toLowerCase()
          const href = el.getAttribute('href') || ''

          if (text.includes('mysql') && text.includes('dump')) {
            if (href) return href.startsWith('http') ? href : `https://www.comics.org${href}`
          }
        }

        // Third try: Any download link
        for (const el of allElements) {
          const text = (el.textContent || '').toLowerCase()
          const href = el.getAttribute('href') || ''

          if (
            text.includes('download') &&
            (href.includes('.gz') || href.includes('.sql') || href.includes('.zip'))
          ) {
            return href.startsWith('http') ? href : `https://www.comics.org${href}`
          }
        }

        // Fourth try: Look at page source for download URLs
        const pageText = document.body.innerHTML
        const urlMatch = pageText.match(/href=["']([^"']*\.(?:sqlite3|sql)(?:\.gz)?[^"']*)["']/i)
        if (urlMatch && urlMatch[1]) {
          const href = urlMatch[1]
          return href.startsWith('http') ? href : `https://www.comics.org${href}`
        }

        return null
      })

      if (!downloadUrl) {
        // Try clicking on the SQLite download link by text matching
        this.logger.info('Trying to find and click download link by text...')

        // Look for elements containing "SQLite" or "Download" text
        const clicked = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)

          let node
          while ((node = walker.nextNode())) {
            const text = node.textContent || ''
            if (text.toLowerCase().includes('sqlite') && text.toLowerCase().includes('download')) {
              const parent = node.parentElement
              if (parent && parent.tagName === 'A') {
                return parent.getAttribute('href')
              }
            }
          }

          // Try looking for any element with download URL in innerHTML
          const bodyHtml = document.body.innerHTML
          const matches = bodyHtml.match(
            /href=["']([^"']*(?:download|dump)[^"']*\.(?:gz|sql|sqlite)[^"']*)["']/gi
          )
          if (matches && matches.length > 0) {
            const match = matches[0].match(/href=["']([^"']+)["']/)
            if (match) return match[1]
          }

          return null
        })

        if (clicked) {
          const resolvedUrl = clicked.startsWith('http')
            ? clicked
            : `https://www.comics.org${clicked}`
          this.logger.info(`Found download URL: ${resolvedUrl}`)

          // Continue with this URL
          await this.downloadDumpWithCookies(resolvedUrl, cookieHeader)
          return
        }

        // Last resort: log page content for debugging
        const pageContent = await page.content()
        const downloadSection = pageContent.match(/Downloads[\s\S]*?(?=<h2|$)/i)?.[0] || ''
        this.logger.error('Download section content:')
        this.logger.info(downloadSection.substring(0, 1000))

        throw new Error('Could not find download link on the download page')
      }

      this.logger.info(`Found download URL: ${downloadUrl}`)

      await this.downloadDumpWithCookies(downloadUrl, cookieHeader)
    } finally {
      await page.close()
      await this.closeBrowser()
    }
  }

  /**
   * Click the SQLite download button directly using Puppeteer
   * and handle the file download via CDP
   */
  private async clickDownloadButton(page: Page): Promise<boolean> {
    try {
      // Ensure download directory exists
      if (!existsSync(this.gcdDownloadDir)) {
        mkdirSync(this.gcdDownloadDir, { recursive: true })
      }

      // Get CDP session to configure downloads
      const client = await page.createCDPSession()
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: this.gcdDownloadDir,
      })

      // Check if SQLite button exists
      const sqliteButton = await page.$('input[type="submit"][name="sqlite"]')
      if (!sqliteButton) {
        this.logger.info('SQLite button not found on page')
        return false
      }

      this.logger.info('Found SQLite download button, clicking...')

      // Click the button and wait for navigation or download
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null),
        sqliteButton.click(),
      ])

      // Check the current URL - might have navigated to a download page or error
      const currentUrl = page.url()

      // Check if we hit an error page
      if (currentUrl.includes('gcd-error') || currentUrl.includes('error')) {
        // Get error message from page
        const errorMessage = await page.evaluate(() => {
          const content = document.body.innerText
          return content.substring(0, 1000)
        })

        // Check for rate limiting
        if (
          errorMessage.includes('within the last 5 minutes') ||
          errorMessage.includes('wait at least 5 minutes')
        ) {
          this.logger.error('GCD rate limit hit: Please wait at least 5 minutes between downloads')
          this.logger.info('This is a GCD website limitation to prevent bandwidth abuse')
          return false
        }

        const errorScreenshot = join(this.gcdDownloadDir, 'gcd-error.png')
        await page.screenshot({ path: errorScreenshot, fullPage: true })
        this.logger.warning(`GCD returned an error page. Screenshot saved: ${errorScreenshot}`)
        this.logger.error(`Error: ${errorMessage.substring(0, 200)}`)
        return false
      }

      // Wait for potential download to start
      await this.sleep(3000)

      // Look for download links on the new page
      const downloadLink = await page.evaluate(() => {
        const links = document.querySelectorAll('a')
        for (const link of links) {
          const href = link.getAttribute('href') || ''
          if (href.includes('.gz') || href.includes('.sqlite') || href.includes('.db')) {
            return href.startsWith('http') ? href : `https://www.comics.org${href}`
          }
        }
        // Also check if page contains a direct download message
        const pageText = document.body.innerText
        if (pageText.includes('download will begin') || pageText.includes('downloading')) {
          return 'AUTO_DOWNLOAD'
        }
        return null
      })

      if (downloadLink && downloadLink !== 'AUTO_DOWNLOAD') {
        this.logger.info(`Found download link: ${downloadLink}`)
        const cookies = await page.cookies()
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
        await this.downloadDumpWithCookies(downloadLink, cookieHeader)
        return true
      }

      // Wait for download to complete (check for file appearance)
      this.logger.info('Waiting for download file to appear...')

      // Poll for the file for up to 2 minutes
      for (let i = 0; i < 24; i++) {
        await this.sleep(5000)
        const files = await this.findDownloadedFile()
        if (files) {
          this.logger.info(`Download detected: ${files}`)
          await this.processDownloadedFile(files)
          this.logger.success('GCD database auto-download complete!')
          return true
        }
        this.logger.info(`Waiting for download... (${(i + 1) * 5}s)`)
      }

      this.logger.warning('Download button clicked but no file detected after 2 minutes')
      return false
    } catch (error) {
      this.logger.error(`Click download failed: ${error}`)
      return false
    }
  }

  /**
   * Find any recently downloaded GCD file in the download directory
   */
  private async findDownloadedFile(): Promise<string | null> {
    const { readdirSync, statSync } = await import('node:fs')

    if (!existsSync(this.gcdDownloadDir)) {
      return null
    }

    const files = readdirSync(this.gcdDownloadDir)
    const gcdFiles = files.filter(
      (f) =>
        (f.includes('sqlite') ||
          f.includes('gcd') ||
          f.includes('current') ||
          f.endsWith('.db') ||
          f.endsWith('.gz') ||
          f.endsWith('.zip')) &&
        !f.endsWith('.png') && // exclude screenshots
        !f.endsWith('.crdownload') // exclude incomplete downloads
    )

    if (gcdFiles.length === 0) {
      return null
    }

    // Return the most recently modified file
    const sortedFiles = gcdFiles
      .map((f) => ({ name: f, mtime: statSync(join(this.gcdDownloadDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    return join(this.gcdDownloadDir, sortedFiles[0].name)
  }

  private async submitDownloadForm(page: Page, cookieHeader: string): Promise<boolean> {
    const formInfo = await page.evaluate(() => {
      // Target the download form specifically (not the search form)
      const form =
        document.querySelector('form.download') ||
        document.querySelector('form[action="/download/"]') ||
        document.querySelector('form[action*="download"]')
      if (!form) return null

      const action = form.getAttribute('action') || window.location.href
      const method = (form.getAttribute('method') || 'GET').toUpperCase()
      const fields: Record<string, string> = {}

      const inputs = form.querySelectorAll('input, select, textarea')
      inputs.forEach((input) => {
        const el = input as HTMLInputElement
        const name = el.name
        if (!name) return

        if (el.tagName === 'SELECT') {
          const select = el as unknown as HTMLSelectElement
          const options = Array.from(select.options)
          const sqliteOption = options.find((opt) =>
            opt.textContent?.toLowerCase().includes('sqlite')
          )
          if (sqliteOption) {
            fields[name] = sqliteOption.value
            return
          }
          const selected = options.find((opt) => opt.selected)
          fields[name] = selected?.value || select.value
          return
        }

        if (el.type === 'checkbox' && !el.checked) return

        if (el.type === 'radio') {
          if (el.checked) {
            fields[name] = el.value
            return
          }

          const radio = document.querySelector<HTMLInputElement>(
            `input[type="radio"][name="${CSS.escape(name)}"]`
          )
          if (radio?.value?.toLowerCase().includes('sqlite')) {
            fields[name] = radio.value
          }
          return
        }

        // Skip submit buttons - we'll add the SQLite one specifically
        if (el.type === 'submit') return

        fields[name] = el.value || 'on'
      })

      // Find and add the SQLite submit button specifically
      const sqliteButton = form.querySelector(
        'input[type="submit"][name="sqlite"]'
      ) as HTMLInputElement
      if (sqliteButton) {
        fields['sqlite'] = sqliteButton.value || 'Download SQLite Dump'
      }

      return { action, method, fields }
    })

    if (!formInfo) {
      return false
    }

    // Check if SQLite button was found
    if (!formInfo.fields['sqlite']) {
      this.logger.warning('SQLite button not found in form - may need to accept terms first')
      return false
    }

    const actionUrl = formInfo.action.startsWith('http')
      ? formInfo.action
      : `https://www.comics.org${formInfo.action}`

    const headers: Record<string, string> = {
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://www.comics.org/download/',
    }

    let response: Response
    if (formInfo.method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      const body = new URLSearchParams(formInfo.fields).toString()
      response = await fetch(actionUrl, {
        method: 'POST',
        headers,
        body,
        redirect: 'follow',
      })
    } else {
      const url = new URL(actionUrl)
      for (const [key, value] of Object.entries(formInfo.fields)) {
        url.searchParams.set(key, value)
      }
      response = await fetch(url.toString(), {
        headers,
        redirect: 'follow',
      })
    }

    if (!response.ok) {
      return false
    }

    const contentDisposition = response.headers.get('content-disposition') || ''
    const contentType = response.headers.get('content-type') || ''

    const isFile =
      contentDisposition.includes('attachment') ||
      /application\//i.test(contentType) ||
      /gzip|octet-stream|sqlite/i.test(contentType)

    if (isFile) {
      const downloadPath = await this.saveResponseToFile(response, actionUrl)
      await this.processDownloadedFile(downloadPath)
      this.logger.success('GCD database auto-download complete!')
      return true
    }

    const html = await response.text()
    const match = html.match(/href=["']([^"']*\.(?:sqlite3|sql)(?:\.gz)?[^"']*)["']/i)
    if (!match || !match[1]) {
      return false
    }

    const downloadUrl = match[1].startsWith('http') ? match[1] : `https://www.comics.org${match[1]}`

    await this.downloadDumpWithCookies(downloadUrl, cookieHeader)
    return true
  }

  private async downloadDumpWithCookies(downloadUrl: string, cookieHeader: string): Promise<void> {
    // Create download directory
    if (!existsSync(this.gcdDownloadDir)) {
      mkdirSync(this.gcdDownloadDir, { recursive: true })
    }

    // Download the file with authenticated session
    this.logger.info('Downloading GCD database (this may take a while)...')

    const response = await fetch(downloadUrl, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    const downloadPath = await this.saveResponseToFile(response, downloadUrl)
    await this.processDownloadedFile(downloadPath)
    this.logger.success('GCD database auto-download complete!')
  }

  private async saveResponseToFile(response: Response, fallbackUrl: string): Promise<string> {
    const contentDisposition = response.headers.get('content-disposition')
    let filename = 'gcd.sqlite3.gz'
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (match) {
        filename = match[1].replace(/['"]/g, '')
      }
    } else {
      filename = fallbackUrl.split('/').pop()?.split('?')[0] || filename
    }

    const downloadPath = join(this.gcdDownloadDir, filename)
    const fileStream = createWriteStream(downloadPath)

    // @ts-ignore - response.body is a ReadableStream
    await pipeline(response.body, fileStream)

    this.logger.success(`Downloaded to ${downloadPath}`)
    return downloadPath
  }

  private async processDownloadedFile(downloadPath: string): Promise<void> {
    if (downloadPath.endsWith('.zip')) {
      this.logger.info('Extracting zip file...')
      const { execSync } = await import('node:child_process')
      const { renameSync, readdirSync } = await import('node:fs')

      // Extract zip to download directory
      execSync(`unzip -o "${downloadPath}" -d "${this.gcdDownloadDir}"`, { stdio: 'inherit' })

      // Find the sqlite database file in extracted contents
      const extractedFiles = readdirSync(this.gcdDownloadDir)
      const dbFile = extractedFiles.find(
        (f) =>
          (f.endsWith('.sqlite3') || f.endsWith('.db') || f.includes('sqlite')) &&
          !f.endsWith('.gz') &&
          !f.endsWith('.zip') &&
          !f.endsWith('.png')
      )

      if (!dbFile) {
        // Check for .gz file that needs decompression
        const gzFile = extractedFiles.find((f) => f.endsWith('.gz'))
        if (gzFile) {
          await this.processDownloadedFile(join(this.gcdDownloadDir, gzFile))
          return
        }
        throw new Error('No SQLite database file found in zip archive')
      }

      const extractedPath = join(this.gcdDownloadDir, dbFile)

      // Rename to standard gcd.db if it has a different name (like date-based names)
      if (dbFile !== 'gcd.db') {
        const standardPath = join(this.gcdDownloadDir, 'gcd.db')
        renameSync(extractedPath, standardPath)
        this.gcdDbPath = standardPath
        this.logger.info(`Renamed ${dbFile} to gcd.db`)
      } else {
        this.gcdDbPath = extractedPath
      }

      // Clean up zip file
      unlinkSync(downloadPath)
      this.logger.success(`Extracted to ${this.gcdDbPath}`)
    } else if (downloadPath.endsWith('.gz')) {
      this.logger.info('Decompressing database...')
      const decompressedPath = downloadPath.replace('.gz', '').replace('.sqlite3', '.db')

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
        .where('external_id', String(pub.id))
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
          external_id: String(pub.id),
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
    let updated = 0
    let skipped = 0

    for (const comic of comics) {
      try {
        const existing = await db
          .from('books')
          .where('data_source', 'gcd')
          .where('external_id', String(comic.id))
          .first()

        // Si le comic est en cours (is_current ou pas de year_ended), chapters = null
        const isOngoing = comic.is_current || !comic.year_ended

        if (existing) {
          if (!this.update) {
            skipped++
            continue
          }

          // Update existing comic
          await db
            .from('books')
            .where('id', existing.id)
            .update({
              title: comic.name,
              release_year: comic.year_began,
              end_year: isOngoing ? null : comic.year_ended,
              status: isOngoing ? 'ongoing' : 'completed',
              chapters: isOngoing ? null : comic.issue_count,
              updated_at: new Date(),
            })
          updated++

          if (updated % 100 === 0) {
            this.logger.info(
              `Progress: ${imported} imported, ${updated} updated, ${skipped} skipped`
            )
          }
          continue
        }

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
            external_id: String(comic.id),
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
          this.logger.info(`Progress: ${imported} imported, ${updated} updated, ${skipped} skipped`)
        }
      } catch (error) {
        this.logger.error(`Failed to import comic ${comic.id}:`, error)
      }
    }

    this.logger.success(
      `Import complete: ${imported} imported, ${updated} updated, ${skipped} skipped`
    )
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
        .where('external_id', String(pubId))
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
   * Get the Issue #1 ID for a series from the GCD database
   * This is the first issue by sort_code (publication order)
   */
  private getIssue1Id(gcdDb: Database.Database, seriesId: number): number | null {
    const result = gcdDb
      .prepare(
        `
      SELECT id FROM gcd_issue
      WHERE series_id = ?
        AND deleted = 0
      ORDER BY sort_code ASC
      LIMIT 1
    `
      )
      .get(seriesId) as { id: number } | undefined

    return result?.id ?? null
  }

  /**
   * Scrape cover image from a specific issue page
   */
  private async scrapeIssueCover(issueId: number): Promise<string | null> {
    if (!this.browser) {
      throw new Error('Browser not initialized')
    }

    const page: Page = await this.browser.newPage()

    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )
      await page.setViewport({ width: 1920, height: 1080 })

      const url = `https://www.comics.org/issue/${issueId}/`
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      await this.sleep(2000)

      // Try to find cover image on the issue page
      // GCD stores covers in /img/gcd/covers_by_id/
      const coverUrl = await page
        .$$eval('img', (imgs) => {
          for (const img of imgs) {
            const src = img.getAttribute('src') || ''
            if (
              src.includes('/img/gcd/covers_by_id/') ||
              src.includes('/CACHE/images/img/gcd/covers')
            ) {
              // Convert to w400 for better quality
              return src.replace('/w200/', '/w400/')
            }
          }
          return null
        })
        .catch(() => null)

      if (coverUrl) {
        return coverUrl
      }

      // Fallback: try to find any cover-like image
      const fallbackCoverUrl = await page
        .$$eval('img', (imgs) => {
          for (const img of imgs) {
            const src = img.getAttribute('src') || ''
            if (src.includes('/w200/') || src.includes('/w400/')) {
              return src.replace('/w200/', '/w400/')
            }
          }
          return null
        })
        .catch(() => null)

      return fallbackCoverUrl
    } catch (error) {
      this.logger.error(`Error scraping issue ${issueId}:`, error)
      return null
    } finally {
      await page.close()
    }
  }

  /**
   * Scrape cover images directly from GCD website using Puppeteer Stealth
   * This bypasses Cloudflare protection
   * Now uses Issue #1 cover instead of series page cover
   */
  private async scrapeGcdCovers(limit?: number) {
    this.logger.info('🕵️ Starting GCD cover scraping with Cloudflare bypass...')
    this.logger.info(`Request delay: ${this.scrapeDelay}ms`)
    this.logger.info('Using Issue #1 cover for each series')

    if (this.forceCovers) {
      this.logger.info('Force mode: will replace existing covers with Issue #1 covers')
    }

    // Get books to scrape covers for
    const query = db
      .from('books')
      .select('id', 'title', 'external_id', 'cover_image')
      .where('data_source', 'gcd')
      .where('type', 'comic')
      .orderBy('id', 'asc')

    // Only filter by missing covers if not forcing
    if (!this.forceCovers) {
      query.whereNull('cover_image')
    }

    if (this.skip) {
      query.offset(this.skip)
      this.logger.info(`Skipping first ${this.skip} books (resume mode)`)
    }

    if (limit) {
      query.limit(limit)
    }

    const books = await query

    this.logger.info(`Found ${books.length} books to process`)

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
          let coverUrl: string | null = null
          const seriesId = Number(book.external_id)

          // Try to get Issue #1 cover if GCD database is available
          if (this.gcdDb) {
            const issue1Id = this.getIssue1Id(this.gcdDb, seriesId)
            if (issue1Id) {
              coverUrl = await this.scrapeIssueCover(issue1Id)
            }
          }

          // Fallback to series page if no Issue #1 found or no database
          if (!coverUrl) {
            coverUrl = await this.scrapeSeriesCover(seriesId)
          }

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
    if (this.browser) {
      return // Already initialized
    }

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
   * Scrape cover image from a GCD series page (fallback method)
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

      // Always go to Issue #1 page - series pages show multiple covers
      // and we can't guarantee which is #1
      {
        // Look for Issue #1 specifically - GCD lists issues in a table
        // Try to find the first issue (usually labeled "1" or at the top of the list)
        const issue1Url = await page
          .evaluate(() => {
            const allLinks = Array.from(document.querySelectorAll('a[href*="/issue/"]'))

            // First try: find a link with text "1" that goes to /issue/
            for (const link of allLinks) {
              const text = link.textContent?.trim()
              // Look for Issue #1 (text is just "1" or starts with "1")
              if (text === '1' || text === '#1' || text === '1 ') {
                return link.getAttribute('href')
              }
            }
            // Fallback: get the first issue link in the issue list table
            const issueTable = document.querySelector('.issue_list, table')
            if (issueTable) {
              const firstIssueLink = issueTable.querySelector('a[href*="/issue/"]')
              if (firstIssueLink) {
                return firstIssueLink.getAttribute('href')
              }
            }
            // Last resort: first issue link on page
            const firstLink = document.querySelector('a[href*="/issue/"]')
            return firstLink?.getAttribute('href') || null
          })
          .catch(() => null)

        if (issue1Url) {
          const fullUrl = issue1Url.startsWith('http')
            ? issue1Url
            : `https://www.comics.org${issue1Url}`

          await page.goto(fullUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000,
          })

          await this.sleep(1500)

          const issueCoverUrl = await page
            .$$eval('img', (imgs) => {
              for (const img of imgs) {
                const src = img.getAttribute('src') || ''
                // Look for actual cover images in GCD's covers_by_id directory
                // Format: /img/gcd/covers_by_id/{id}/w400/{issue_id}.jpg
                if (
                  src.includes('/img/gcd/covers_by_id/') ||
                  src.includes('/CACHE/images/img/gcd/covers')
                ) {
                  // Convert to w400 for better quality
                  return src.replace('/w200/', '/w400/')
                }
              }
              return null
            })
            .catch(() => null)

          return issueCoverUrl
        }
      }

      return null
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
