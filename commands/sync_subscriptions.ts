import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class SyncSubscriptions extends BaseCommand {
  static commandName = 'sync:subscriptions'
  static description = 'Mark expired subscriptions as expired in the database'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting subscription sync...')

    const result = await DatabaseMaintenanceService.syncSubscriptions()

    if (result.error) {
      this.logger.error(`Sync failed: ${result.error}`)
      return
    }

    this.logger.success(`Sync complete! Updated ${result.updatedCount || 0} expired subscriptions.`)
  }
}
