import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export default class ImportMyanimelist extends BaseCommand {
  static commandName = 'import:myanimelist'
  static description = 'Import all MyAnimeList manga entries into Trackr database'

  static options: CommandOptions = {}

  async run() {
    this.logger.info('Importing MyAnimeList manga entries into Trackr database...')
    await execAsync('node scripts/import_manga.js')
  }
}
