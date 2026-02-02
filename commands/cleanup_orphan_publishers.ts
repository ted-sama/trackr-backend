import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupOrphanPublishers extends BaseCommand {
  static commandName = 'cleanup:orphan-publishers'
  static description =
    'Clean up orphaned publishers (publishers with no books). NOT SCHEDULED - Manual execution only.'

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
      this.logger.warning('Running in DRY-RUN mode - no publishers will be deleted')
      this.logger.info('Use --no-dry-run to actually delete orphaned publishers')
    }

    this.logger.info('Starting orphaned publishers cleanup...')

    const result = await DatabaseMaintenanceService.cleanupOrphanPublishers(isDryRun)

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    if (isDryRun) {
      this.logger.info(`Found ${result.deletedCount} orphaned publishers that would be deleted.`)
    } else {
      this.logger.success(`Cleanup complete! Deleted ${result.deletedCount} orphaned publishers.`)
    }
  }
}
