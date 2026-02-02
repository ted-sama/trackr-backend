import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class DbStats extends BaseCommand {
  static commandName = 'db:stats'
  static description = 'Display database statistics and counts for all tables'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Fetching database statistics...')
    this.logger.info('========================================')

    const stats = await DatabaseMaintenanceService.getDatabaseStats()

    const categories = {
      'Core Tables': ['users', 'books', 'authors', 'publishers'],
      'Token Tables': ['refresh_tokens', 'password_reset_tokens'],
      'User Content': ['book_recaps', 'notifications', 'activity_logs'],
      Moderation: ['reports', 'moderated_content', 'user_strikes'],
    }

    for (const [category, tables] of Object.entries(categories)) {
      this.logger.info(`\n${category}:`)
      this.logger.info('----------------------------------------')
      for (const table of tables) {
        const count = stats[table]
        const status = count === -1 ? 'error' : count.toLocaleString()
        this.logger.info(`  ${table.padEnd(25)} ${status}`)
      }
    }

    // Maintenance indicators
    this.logger.info('\n\nMaintenance Indicators:')
    this.logger.info('----------------------------------------')
    this.logger.info(
      `  Expired refresh tokens:   ${stats['expired_refresh_tokens']?.toLocaleString() || 'N/A'}`
    )
    this.logger.info(
      `  Expired book recaps:      ${stats['expired_book_recaps']?.toLocaleString() || 'N/A'}`
    )

    // Recommendations
    this.logger.info('\n')
    if ((stats['expired_refresh_tokens'] || 0) > 100) {
      this.logger.warning(
        'Consider running: node ace cleanup:tokens (many expired refresh tokens)'
      )
    }
    if ((stats['expired_book_recaps'] || 0) > 50) {
      this.logger.warning(
        'Consider running: node ace cleanup:book-recaps (many expired book recaps)'
      )
    }
    if ((stats['notifications'] || 0) > 10000) {
      this.logger.warning(
        'Consider running: node ace cleanup:notifications (large notifications table)'
      )
    }
    if ((stats['activity_logs'] || 0) > 50000) {
      this.logger.warning(
        'Consider running: node ace cleanup:activity-logs (large activity logs table)'
      )
    }

    this.logger.success('\nStatistics retrieved successfully!')
  }
}
