import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import List from '#models/list'
import { updateSchema, updateBackdropSchema, updateAvatarSchema } from '#validators/user'
import { cuid } from '@adonisjs/core/helpers'

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

  async update({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { username, backdropMode, backdropColor, backdropImage } =
      await request.validateUsing(updateSchema)

    if (backdropMode === 'image') {
      if (user.plan === 'free') {
        return response.unauthorized({
          message: 'You must be a Plus user to use an image as backdrop for your profile',
        })
      }
    }

    await user.merge({ username, backdropMode, backdropColor, backdropImage }).save()
    return response.ok(user)
  }

  async uploadAvatar({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { avatar } = await request.validateUsing(updateAvatarSchema)

    if (!avatar) {
      return response.badRequest({ message: 'No image provided' })
    }

    if (!avatar.isValid) {
      return response.badRequest({ errors: avatar.errors })
    }

    const key = `images/user/avatar/${cuid()}.${avatar.extname}`
    await avatar.moveToDisk(key)

    await user.merge({ avatar: avatar.meta.url }).save()

    return response.accepted({})
  }

  async uploadBackdropImage({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { backdrop } = await request.validateUsing(updateBackdropSchema)

    if (!backdrop) {
      return response.badRequest({ message: 'No image provided' })
    }

    if (!backdrop.isValid) {
      return response.badRequest({ errors: backdrop.errors })
    }

    const key = `images/user/backdrop/${cuid()}.${backdrop.extname}`
    await backdrop.moveToDisk(key)

    await user.merge({ backdropImage: backdrop.meta.url }).save()

    return response.accepted({})
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

  async showTopBooks({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const topBooks = await user.related('topBooks').query()
    return response.ok(topBooks)
  }
}
