import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class ProcessExpiredBans extends BaseCommand {
  static commandName = 'process:expired-bans'
  static description = 'Unban users whose temporary ban has expired'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting expired bans processing...')

    const result = await DatabaseMaintenanceService.processExpiredBans()

    if (result.error) {
      this.logger.error(`Processing failed: ${result.error}`)
      return
    }

    this.logger.success(`Processing complete! Unbanned ${result.updatedCount || 0} users.`)
  }
}
