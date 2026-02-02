import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

export default class ResetChatLimits extends BaseCommand {
  static commandName = 'reset:chat-limits'
  static description = 'Reset chat request limits for users whose reset time has passed'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting chat limits reset...')

    const result = await DatabaseMaintenanceService.resetChatLimits()

    if (result.error) {
      this.logger.error(`Reset failed: ${result.error}`)
      return
    }

    this.logger.success(`Reset complete! Updated ${result.updatedCount || 0} users.`)
  }
}
