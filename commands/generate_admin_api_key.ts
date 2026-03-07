import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { randomBytes } from 'node:crypto'

export default class GenerateAdminApiKey extends BaseCommand {
  static commandName = 'generate:admin-api-key'
  static description = 'Generate a secure random API key for admin API authentication'

  static options: CommandOptions = {
    startApp: false,
  }

  async run() {
    const key = randomBytes(32).toString('hex')

    this.logger.info('Generated admin API key:')
    this.logger.info('')
    this.logger.info(`  ${key}`)
    this.logger.info('')
    this.logger.info('Add it to your .env file:')
    this.logger.info('')
    this.logger.info(`  ADMIN_API_KEY_TED=${key}`)
    this.logger.info('  # or')
    this.logger.info(`  ADMIN_API_KEY_ZANGO=${key}`)
    this.logger.info('')
    this.logger.info('⚠️  Generate a separate key for each user.')
  }
}
