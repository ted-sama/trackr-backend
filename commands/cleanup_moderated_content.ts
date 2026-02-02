import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupModeratedContent extends BaseCommand {
  static commandName = 'cleanup:moderated-content'
  static description = 'Clean up old inactive moderated content records from the database'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({
    description: 'Number of days to retain inactive moderated content (default: 180)',
    alias: 'd',
  })
  declare days: number

  async run() {
    const retentionDays = this.days || 180

    this.logger.info(
      `Starting moderated content cleanup (retaining inactive content from last ${retentionDays} days)...`
    )

    const result = await DatabaseMaintenanceService.cleanupModeratedContent(retentionDays)

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    this.logger.success(
      `Cleanup complete! Deleted ${result.deletedCount} old moderated content records.`
    )
  }
}
