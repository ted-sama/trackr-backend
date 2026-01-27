import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import RefreshToken from '#models/refresh_token'

export default class CleanupTokens extends BaseCommand {
  static commandName = 'cleanup:tokens'
  static description = 'Clean up expired and revoked refresh tokens from the database'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting token cleanup...')

    const deletedCount = await RefreshToken.cleanupExpiredAndRevoked()

    this.logger.success(`Cleanup complete! Deleted ${deletedCount} tokens.`)
  }
}
