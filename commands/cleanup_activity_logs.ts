import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupActivityLogs extends BaseCommand {
  static commandName = 'cleanup:activity-logs'
  static description = 'Clean up old activity logs from the database'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({
    description: 'Number of days to retain activity logs (default: 365)',
    alias: 'd',
  })
  declare days: number

  async run() {
    const retentionDays = this.days || 365

    this.logger.info(`Starting activity logs cleanup (retaining last ${retentionDays} days)...`)

    const result = await DatabaseMaintenanceService.cleanupActivityLogs(retentionDays)

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    this.logger.success(`Cleanup complete! Deleted ${result.deletedCount} old activity logs.`)
  }
}
