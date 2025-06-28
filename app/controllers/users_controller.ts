import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import List from '#models/list'

export default class UsersController {
  async me({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    return response.ok(user)
  }

  async showLists({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const lists = await List.query().where('user_id', user.id)
    return response.ok(lists)
  }

  async showLibrary({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const library = await user.related('bookTrackings').query().preload('book')
    return response.ok(library)
  }
}
