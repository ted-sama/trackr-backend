import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class CleanupPasswordTokens extends BaseCommand {
  static commandName = 'cleanup:password-tokens'
  static description = 'Clean up expired password reset tokens from the database'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting password reset token cleanup...')

    const result = await DatabaseMaintenanceService.cleanupPasswordResetTokens()

    if (result.error) {
      this.logger.error(`Cleanup failed: ${result.error}`)
      return
    }

    this.logger.success(`Cleanup complete! Deleted ${result.deletedCount} expired tokens.`)
  }
}
