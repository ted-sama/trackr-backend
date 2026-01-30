import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'
import List from '#models/list'
import ImageStorageService from '#services/image_storage_service'

export default class CleanupOrphanedImages extends BaseCommand {
  static commandName = 'cleanup:orphaned-images'
  static description = 'Clean up orphaned images from R2 storage that are no longer referenced in the database'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.boolean({ description: 'Run in dry-run mode (show what would be deleted without actually deleting)' })
  declare dryRun: boolean

  @flags.boolean({ description: 'Verbose output' })
  declare verbose: boolean

  async run() {
    this.logger.info('Starting orphaned image cleanup...')

    if (this.dryRun) {
      this.logger.warning('Running in DRY-RUN mode - no files will be deleted')
    }

    // Collect all active image URLs from the database
    const activeUrls = new Set<string>()

    // User avatars
    this.logger.info('Collecting user avatar URLs...')
    const usersWithAvatars = await User.query()
      .whereNotNull('avatar')
      .select('avatar')
    for (const user of usersWithAvatars) {
      if (user.avatar) {
        activeUrls.add(user.avatar)
      }
    }
    this.logger.info(`Found ${usersWithAvatars.length} user avatars in database`)

    // User backdrop images
    this.logger.info('Collecting user backdrop URLs...')
    const usersWithBackdrops = await User.query()
      .whereNotNull('backdropImage')
      .select('backdropImage')
    for (const user of usersWithBackdrops) {
      if (user.backdropImage) {
        activeUrls.add(user.backdropImage)
      }
    }
    this.logger.info(`Found ${usersWithBackdrops.length} user backdrop images in database`)

    // List backdrop images
    this.logger.info('Collecting list backdrop URLs...')
    const listsWithBackdrops = await List.query()
      .whereNotNull('backdropImage')
      .select('backdropImage')
    for (const list of listsWithBackdrops) {
      if (list.backdropImage) {
        activeUrls.add(list.backdropImage)
      }
    }
    this.logger.info(`Found ${listsWithBackdrops.length} list backdrop images in database`)

    this.logger.info(`Total active images in database: ${activeUrls.size}`)

    // List all files in R2 storage directories
    const directories = [
      'images/user/avatar',
      'images/user/backdrop',
      'images/list/backdrop',
    ]

    let totalOrphaned = 0
    let totalDeleted = 0

    for (const directory of directories) {
      this.logger.info(`\nScanning R2 directory: ${directory}`)

      const filesInR2 = await ImageStorageService.listFilesInDirectory(directory)
      this.logger.info(`Found ${filesInR2.length} files in R2`)

      // Find orphaned files (in R2 but not in database)
      const orphanedFiles: string[] = []

      for (const fileKey of filesInR2) {
        // Reconstruct the full URL from the key
        const fullUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`

        if (!activeUrls.has(fullUrl)) {
          orphanedFiles.push(fileKey)
          if (this.verbose) {
            this.logger.info(`  Orphaned: ${fileKey}`)
          }
        }
      }

      totalOrphaned += orphanedFiles.length
      this.logger.info(`Found ${orphanedFiles.length} orphaned files in ${directory}`)

      // Delete orphaned files (unless dry-run)
      if (!this.dryRun && orphanedFiles.length > 0) {
        this.logger.info(`Deleting ${orphanedFiles.length} orphaned files...`)

        for (const fileKey of orphanedFiles) {
          // Build URL for deletion
          const fullUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`
          const deleted = await ImageStorageService.deleteByUrl(fullUrl)
          if (deleted) {
            totalDeleted++
            if (this.verbose) {
              this.logger.info(`  Deleted: ${fileKey}`)
            }
          }
        }
      }
    }

    // Summary
    this.logger.info('\n========================================')
    this.logger.info('Cleanup Summary')
    this.logger.info('========================================')
    this.logger.info(`Total active images in database: ${activeUrls.size}`)
    this.logger.info(`Total orphaned files found: ${totalOrphaned}`)

    if (this.dryRun) {
      this.logger.warning(`Files that would be deleted: ${totalOrphaned}`)
      this.logger.info('Run without --dry-run to delete these files')
    } else {
      this.logger.success(`Files deleted: ${totalDeleted}`)
    }
  }
}
