import User from '#models/user'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class UserCreate extends BaseCommand {
  static commandName = 'user:create'
  static description = 'Create a new user'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const email: string = await this.prompt.ask('Enter the email of the user')
    const password: string = await this.prompt.ask('Enter the password of the user')
    const username: string = await this.prompt.ask('Enter the username of the user')
    const displayName: string = await this.prompt.ask('Enter the display name of the user')
    const plan: 'free' | 'plus' = (await this.prompt.ask('Enter the plan of the user')) as
      | 'free'
      | 'plus'
    const role: 'admin' | 'user' = (await this.prompt.ask('Enter the role of the user')) as
      | 'admin'
      | 'user'
    const user = await User.create({ email, password, username, displayName, plan, role })
    this.logger.info(`User created: ${user.email}, password: ${password}`)
  }
}
