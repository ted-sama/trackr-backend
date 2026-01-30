import drive from '@adonisjs/drive/services/main'
import env from '#start/env'

/**
 * Service for managing images stored in R2 (Cloudflare)
 * Provides utilities to delete images by URL and extract keys from URLs
 */
export default class ImageStorageService {
  /**
   * Extract the R2 key from a CDN URL
   * Example: https://cdn.example.com/images/user/avatar/abc123.jpg -> images/user/avatar/abc123.jpg
   */
  static extractKeyFromUrl(url: string | null | undefined): string | null {
    if (!url) {
      return null
    }

    const cdnUrl = env.get('R2_PUBLIC_URL')
    if (!cdnUrl) {
      return null
    }

    // Ensure cdnUrl ends without trailing slash
    const normalizedCdnUrl = cdnUrl.endsWith('/') ? cdnUrl.slice(0, -1) : cdnUrl

    // Check if URL starts with CDN URL
    if (!url.startsWith(normalizedCdnUrl)) {
      return null
    }

    // Extract the key (path after CDN URL)
    const key = url.slice(normalizedCdnUrl.length)

    // Remove leading slash if present
    return key.startsWith('/') ? key.slice(1) : key
  }

  /**
   * Delete an image from R2 by its CDN URL
   * Safely handles null/undefined URLs and already-deleted files
   */
  static async deleteByUrl(url: string | null | undefined): Promise<boolean> {
    const key = this.extractKeyFromUrl(url)

    if (!key) {
      return false
    }

    try {
      const disk = drive.use('s3')
      await disk.delete(key)
      return true
    } catch (error) {
      // Log but don't throw - file might already be deleted
      console.warn(`Failed to delete image from R2: ${key}`, error)
      return false
    }
  }

  /**
   * Delete multiple images from R2 by their CDN URLs
   */
  static async deleteMultipleByUrls(urls: (string | null | undefined)[]): Promise<number> {
    let deletedCount = 0

    for (const url of urls) {
      const deleted = await this.deleteByUrl(url)
      if (deleted) {
        deletedCount++
      }
    }

    return deletedCount
  }

  /**
   * List all files in a specific R2 directory
   * Used for orphan cleanup
   */
  static async listFilesInDirectory(prefix: string): Promise<string[]> {
    const disk = drive.use('s3')
    const files: string[] = []

    try {
      const result = await disk.listAll(prefix)

      for (const object of result.objects) {
        if (object.isFile) {
          files.push(object.key)
        }
      }
    } catch (error) {
      console.error(`Failed to list files in directory: ${prefix}`, error)
    }

    return files
  }
}
