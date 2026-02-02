import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupNotifications extends BaseCommand {
  static commandName = 'cleanup:notifications'
  static description = 'Clean up old notifications from the database'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({
    description: 'Number of days to retain notifications (default: 90)',
    alias: 'd',
  })
  declare days: number

  async run() {
    const retentionDays = this.days || 90

    this.logger.info(`Starting notifications cleanup (retaining last ${retentionDays} days)...`)

    const result = await DatabaseMaintenanceService.cleanupNotifications(retentionDays)

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    this.logger.success(`Cleanup complete! Deleted ${result.deletedCount} old notifications.`)
  }
}
