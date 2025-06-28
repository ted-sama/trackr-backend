import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'

export default class UsersController {
  async me({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    return response.ok(user)
  }
}
