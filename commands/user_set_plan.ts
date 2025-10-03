import User from '#models/user'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class UserSetPlan extends BaseCommand {
  static commandName = 'user:set-plan'
  static description = 'Change the plan of a user'

  static options: CommandOptions = {}

  async run() {
    const email = await this.prompt.ask('Enter the email of the user')
    const plan: 'free' | 'plus' = (await this.prompt.ask('Enter the plan of the user')) as
      | 'free'
      | 'plus'
    const user = await User.findBy('email', email)
    if (!user) {
      this.logger.error('User not found')
      return
    }
    user.plan = plan
    await user.save()
    this.logger.info(`Plan changed to ${plan}`)
  }
}
