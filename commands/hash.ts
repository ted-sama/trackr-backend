import { BaseCommand } from '@adonisjs/core/ace'
import hash from '@adonisjs/core/services/hash'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'

export default class Hash extends BaseCommand {
  static commandName = 'hash'
  static description = ''

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const user = await User.findBy('email', 'teddynsoki@gmail.com')
    if (!user) {
      this.logger.error('User not found')
      return
    }

    const password = await this.prompt.ask('Enter password')
    const hashedPassword = await hash.make(password)
    user.password = hashedPassword
    await user.save()
    this.logger.info(`Password changed: ${hashedPassword}`)
  }
}
