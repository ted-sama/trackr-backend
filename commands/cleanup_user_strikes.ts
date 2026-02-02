import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupUserStrikes extends BaseCommand {
  static commandName = 'cleanup:user-strikes'
  static description = 'Clean up expired user strikes and update user strike counts'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting user strikes cleanup...')

    const result = await DatabaseMaintenanceService.cleanupExpiredStrikes()

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    this.logger.success(
      `Cleanup complete! Deleted ${result.deletedCount} expired strikes, updated ${result.updatedCount || 0} users.`
    )
  }
}
