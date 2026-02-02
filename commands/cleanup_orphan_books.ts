import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupOrphanBooks extends BaseCommand {
  static commandName = 'cleanup:orphan-books'
  static description =
    'Clean up orphaned books (books with no tracking and not in any list). NOT SCHEDULED - Manual execution only.'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.boolean({
    description: 'Run in dry-run mode (show what would be deleted without actually deleting)',
  })
  declare dryRun: boolean

  async run() {
    const isDryRun = this.dryRun !== false // Default to dry-run for safety

    if (isDryRun) {
      this.logger.warning('Running in DRY-RUN mode - no books will be deleted')
      this.logger.info('Use --no-dry-run to actually delete orphaned books')
    }

    this.logger.info('Starting orphaned books cleanup...')

    const result = await DatabaseMaintenanceService.cleanupOrphanBooks(isDryRun)

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    if (isDryRun) {
      this.logger.info(`Found ${result.deletedCount} orphaned books that would be deleted.`)
    } else {
      this.logger.success(`Cleanup complete! Deleted ${result.deletedCount} orphaned books.`)
    }
  }
}
