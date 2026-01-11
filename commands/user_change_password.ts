import User from '#models/user'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class UserChangePassword extends BaseCommand {
  static commandName = 'user:change-password'
  static description = 'Change the password of an existing user'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    const email = await this.prompt.ask('Enter the email of the user')

    const user = await User.findBy('email', email)
    if (!user) {
      this.logger.error('User not found')
      return
    }

    const newPassword = await this.prompt.secure('Enter the new password')
    if (!newPassword || newPassword.length < 8) {
      this.logger.error('Password must be at least 8 characters')
      return
    }

    const confirmPassword = await this.prompt.secure('Confirm the new password')
    if (newPassword !== confirmPassword) {
      this.logger.error('Passwords do not match')
      return
    }

    user.password = newPassword
    await user.save()

    this.logger.success(`Password changed successfully for user: ${user.email}`)
  }
}
