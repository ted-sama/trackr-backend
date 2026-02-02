import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class DbMaintenance extends BaseCommand {
  static commandName = 'db:maintenance'
  static description =
    'Run database maintenance tasks. Choose between daily, weekly, or monthly schedules.'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({
    description: 'Maintenance schedule: daily, weekly, monthly, or stats',
    alias: 's',
  })
  declare schedule: string

  @flags.boolean({
    description: 'Show detailed output for each task',
    alias: 'v',
  })
  declare verbose: boolean

  async run() {
    const schedule = this.schedule || 'daily'

    this.logger.info(`Running ${schedule} database maintenance...`)
    this.logger.info('========================================')

    let report

    switch (schedule) {
      case 'stats':
        await this.showStats()
        return

      case 'daily':
        report = await DatabaseMaintenanceService.runDailyMaintenance()
        break

      case 'weekly':
        report = await DatabaseMaintenanceService.runWeeklyMaintenance()
        break

      case 'monthly':
        report = await DatabaseMaintenanceService.runMonthlyMaintenance()
        break

      default:
        this.logger.error(`Unknown schedule: ${schedule}`)
        this.logger.info('Available schedules: daily, weekly, monthly, stats')
        return
    }

    // Display results
    if (this.verbose) {
      this.logger.info('\nTask Results:')
      this.logger.info('----------------------------------------')
      for (const result of report.results) {
        const status = result.error ? '✗' : '✓'
        const deleted = result.deletedCount > 0 ? `deleted: ${result.deletedCount}` : ''
        const updated = result.updatedCount ? `updated: ${result.updatedCount}` : ''
        const details = [deleted, updated].filter(Boolean).join(', ') || 'no changes'
        const error = result.error ? ` (Error: ${result.error})` : ''
        this.logger.info(`  ${status} ${result.task}: ${details}${error}`)
      }
    }

    // Summary
    this.logger.info('\n========================================')
    this.logger.info('Maintenance Summary')
    this.logger.info('========================================')
    this.logger.info(`Schedule: ${schedule}`)
    this.logger.info(`Started: ${report.startedAt.toFormat('yyyy-MM-dd HH:mm:ss')}`)
    this.logger.info(`Completed: ${report.completedAt.toFormat('yyyy-MM-dd HH:mm:ss')}`)
    this.logger.info(
      `Duration: ${report.completedAt.diff(report.startedAt, 'seconds').seconds.toFixed(2)}s`
    )
    this.logger.info(`Tasks executed: ${report.results.length}`)
    this.logger.info(`Total records deleted: ${report.totalDeleted}`)
    this.logger.info(`Total records updated: ${report.totalUpdated}`)

    if (report.errors.length > 0) {
      this.logger.error(`\nErrors (${report.errors.length}):`)
      for (const error of report.errors) {
        this.logger.error(`  - ${error}`)
      }
    } else {
      this.logger.success('\nAll tasks completed successfully!')
    }
  }

  private async showStats() {
    this.logger.info('Fetching database statistics...')

    const stats = await DatabaseMaintenanceService.getDatabaseStats()

    this.logger.info('\nDatabase Statistics:')
    this.logger.info('----------------------------------------')

    const categories = {
      'Core Tables': ['users', 'books', 'authors', 'publishers'],
      'Token Tables': ['refresh_tokens', 'password_reset_tokens', 'expired_refresh_tokens'],
      'User Content': ['book_recaps', 'expired_book_recaps', 'notifications', 'activity_logs'],
      Moderation: ['reports', 'moderated_content', 'user_strikes'],
    }

    for (const [category, tables] of Object.entries(categories)) {
      this.logger.info(`\n${category}:`)
      for (const table of tables) {
        const count = stats[table]
        const status = count === -1 ? 'error' : count.toLocaleString()
        this.logger.info(`  ${table}: ${status}`)
      }
    }
  }
}
