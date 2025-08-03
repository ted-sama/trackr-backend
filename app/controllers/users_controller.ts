import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import List from '#models/list'

export default class UsersController {
  /**
   * @summary Get current user profile
   * @tag Users
   * @description Returns the authenticated user's profile information
   * @responseBody 200 - <User>.exclude(password) - Current user profile
   * @responseBody 401 - Unauthorized
   */
  async me({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    return response.ok(user)
  }

  /**
   * @summary Get user's lists
   * @tag Users
   * @description Returns a paginated list of the authenticated user's lists
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page - @type(number)
   * @responseBody 200 - <List[]>.with(owner, bookItems).paginated() - User's lists with pagination
   * @responseBody 401 - Unauthorized
   */
  async showLists({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { page = 1, limit = 10 } = request.qs()
    const lists = (
      await List.query()
        .where('user_id', user.id)
        .preload('user')
        .preload('bookItems')
        .paginate(page, limit)
    ).serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })
    return response.ok(lists)
  }
}
