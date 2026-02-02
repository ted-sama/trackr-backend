import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupBookRecaps extends BaseCommand {
  static commandName = 'cleanup:book-recaps'
  static description = 'Clean up expired book recaps from the database'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting book recaps cleanup...')

    const result = await DatabaseMaintenanceService.cleanupBookRecaps()

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    this.logger.success(`Cleanup complete! Deleted ${result.deletedCount} expired recaps.`)
  }
}
