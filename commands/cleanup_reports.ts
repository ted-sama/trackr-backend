import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupReports extends BaseCommand {
  static commandName = 'cleanup:reports'
  static description = 'Clean up old resolved/rejected reports from the database'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({
    description: 'Number of days to retain resolved reports (default: 180)',
    alias: 'd',
  })
  declare days: number

  async run() {
    const retentionDays = this.days || 180

    this.logger.info(
      `Starting reports cleanup (retaining resolved reports from last ${retentionDays} days)...`
    )

    const result = await DatabaseMaintenanceService.cleanupResolvedReports(retentionDays)

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    this.logger.success(`Cleanup complete! Deleted ${result.deletedCount} old reports.`)
  }
}
