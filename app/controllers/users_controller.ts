import type { HttpContext } from '@adonisjs/core/http'
import List from '#models/list'
import {
  showSchema,
  updateSchema,
  updateBackdropSchema,
  updateAvatarSchema,
  showListsQuerySchema,
} from '#validators/user'
import { reorderTopBooksValidator } from '#validators/library'
import { cuid } from '@adonisjs/core/helpers'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import AppError from '#exceptions/app_error'
import ActivityLog from '#models/activity_log'
import { ActivityLogEnricher } from '#services/activity_log_enricher'

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
   * @summary Search users
   * @tag Users
   * @description Search for users by username or display name
   * @paramQuery q - Search query - @type(string) @required
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 50) - @type(number)
   * @responseBody 200 - <User[]>.paginated() - List of users matching the search query
   */
  async search({ request, response }: HttpContext) {
    const q = request.input('q', '')
    const page = request.input('page', 1)
    const limit = Math.min(request.input('limit', 10), 50)

    if (!q || q.trim().length === 0) {
      return response.ok({
        meta: { total: 0, per_page: limit, current_page: page, last_page: 0 },
        data: [],
      })
    }

    const normalizedQuery = q.trim().toLowerCase()

    const queryBuilder = User.query().where((qb) => {
      qb.whereRaw('LOWER(username) = ?', [normalizedQuery])
        .orWhereILike('username', `%${normalizedQuery}%`)
        .orWhereRaw('LOWER(display_name) = ?', [normalizedQuery])
        .orWhereILike('display_name', `%${normalizedQuery}%`)
    })

    const paginated = await queryBuilder.orderBy('username', 'asc').paginate(page, limit)

    const users = paginated.serialize({
      fields: {
        pick: ['id', 'username', 'displayName', 'avatar', 'plan', 'createdAt'],
      },
    })

    return response.ok(users)
  }

  async show({ request, response }: HttpContext) {
    const { params } = await request.validateUsing(showSchema)
    const { username } = params
    const userRecord = await User.query().where('username', username).first()
    const user = userRecord?.serialize({
      fields: {
        pick: [
          'id',
          'username',
          'displayName',
          'avatar',
          'plan',
          'backdropMode',
          'backdropColor',
          'backdropImage',
          'createdAt',
        ],
      },
    })

    if (!user) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    return response.ok(user)
  }

  async showUserTopBooks({ request, response }: HttpContext) {
    const { params } = await request.validateUsing(showSchema)
    const { username } = params

    const userRecord = await User.query().where('username', username).first()

    if (!userRecord) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    const topBooks = await userRecord
      .related('topBooks')
      .query()
      .orderBy('users_top_books.position', 'asc')
      .preload('authors')

    return response.ok(topBooks)
  }

  async showUserLists({ request, response }: HttpContext) {
    const { params } = await request.validateUsing(showSchema)
    const { username } = params
    const {
      page = 1,
      limit = 10,
      sort,
      order,
      q,
    } = await request.validateUsing(showListsQuerySchema)

    const userRecord = await User.query().where('username', username).first()

    if (!userRecord) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    const queryBuilder = List.query()
      .where('user_id', userRecord.id)
      .where('is_my_library', false)
      .where('is_public', true)

    if (q && q.trim()) {
      const normalizedQuery = q.trim().toLowerCase()
      queryBuilder.where((qb) => {
        qb.whereRaw('LOWER(name) = ?', [normalizedQuery])
          .orWhereILike('name', `%${normalizedQuery}%`)
          .orWhereRaw('LOWER(description) = ?', [normalizedQuery])
          .orWhereILike('description', `%${normalizedQuery}%`)
          .orWhereRaw('EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE LOWER(tag) = ?)', [
            normalizedQuery,
          ])
          .orWhereRaw('EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE LOWER(tag) LIKE ?)', [
            `%${normalizedQuery}%`,
          ])
          .orWhereILike('search_text', `%${normalizedQuery}%`)
      })
    }

    const sortField = sort ?? 'created_at'
    const sortOrder = order ?? 'desc'
    queryBuilder.orderBy(sortField, sortOrder)

    const paginated = await queryBuilder
      .preload('user')
      .preload('bookItems', (bookItemsQuery) => {
        bookItemsQuery.preload('authors')
      })
      .paginate(page, limit)
    const lists = paginated.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    return response.ok(lists)
  }

  async update({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { username, displayName, backdropMode, backdropColor } =
      await request.validateUsing(updateSchema)

    if (username && username !== user.username) {
      const existingUserByUsername = await User.findBy('username', username)
      if (existingUserByUsername) {
        throw new AppError('Username already used', {
          status: 409,
          code: 'AUTH_USERNAME_TAKEN',
        })
      }

      if (username.trim().includes(' ')) {
        throw new AppError('Username cannot contain spaces', {
          status: 400,
          code: 'USER_USERNAME_INVALID',
        })
      }
    }

    if (backdropMode === 'image') {
      if (user.plan === 'free') {
        throw new AppError('You must be a Plus user to use an image as backdrop for your profile', {
          status: 401,
          code: 'USER_PLUS_REQUIRED',
        })
      }
    }

    if (backdropMode === 'color') {
      user.merge({ backdropImage: null })
    }

    await user.merge({ username, displayName, backdropMode, backdropColor }).save()
    return response.ok(user)
  }

  async uploadAvatar({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { avatar } = await request.validateUsing(updateAvatarSchema)

    if (!avatar) {
      throw new AppError('No image provided', {
        status: 400,
        code: 'USER_AVATAR_NO_IMAGE_PROVIDED',
      })
    }

    if (!avatar.isValid) {
      throw new AppError('Invalid image upload', {
        status: 400,
        code: 'USER_AVATAR_INVALID',
      })
    }

    const key = `images/user/avatar/${cuid()}.${avatar.extname}`
    await avatar.moveToDisk(key)

    await user.merge({ avatar: avatar.meta.url }).save()

    return response.accepted({})
  }

  async deleteAvatar({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    await user.merge({ avatar: null }).save()
    return response.accepted({})
  }

  async uploadBackdropImage({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { backdrop } = await request.validateUsing(updateBackdropSchema)

    if (!backdrop) {
      throw new AppError('No image provided', {
        status: 400,
        code: 'USER_BACKDROP_NO_IMAGE_PROVIDED',
      })
    }

    if (!backdrop.isValid) {
      throw new AppError('Invalid image upload', {
        status: 400,
        code: 'USER_BACKDROP_INVALID',
      })
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
   * @paramQuery limit - Number of items per page (max 100) - @type(number)
   * @paramQuery sort - Sort field: created_at | name - @type(string)
   * @paramQuery order - Sort direction: asc | desc - @type(string)
   * @paramQuery q - Search term (filters by name/description/tags) - @type(string)
   * @responseHeader X-Total - Total number of items
   * @responseHeader X-Per-Page - Items per page
   * @responseHeader X-Current-Page - Current page number
   * @responseHeader X-Last-Page - Last page number
   * @responseBody 200 - <List[]>.with(owner, bookItems).paginated() - User's lists with pagination
   * @responseBody 401 - Unauthorized
   */
  async showLists({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const {
      page = 1,
      limit = 10,
      sort,
      order,
      q,
    } = await request.validateUsing(showListsQuerySchema)

    const queryBuilder = List.query().where('user_id', user.id)

    if (q && q.trim()) {
      const normalizedQuery = q.trim().toLowerCase()
      queryBuilder.where((qb) => {
        qb.whereRaw('LOWER(name) = ?', [normalizedQuery])
          .orWhereILike('name', `%${normalizedQuery}%`)
          .orWhereRaw('LOWER(description) = ?', [normalizedQuery])
          .orWhereILike('description', `%${normalizedQuery}%`)
          .orWhereRaw(
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(tags::jsonb, '[]'::jsonb)) AS tag WHERE LOWER(tag) = ?)",
            [normalizedQuery]
          )
          .orWhereRaw(
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(tags::jsonb, '[]'::jsonb)) AS tag WHERE LOWER(tag) LIKE ?)",
            [`%${normalizedQuery}%`]
          )
          .orWhereILike('search_text', `%${normalizedQuery}%`)
      })
    }

    // Default sort: created_at desc
    const sortField = sort ?? 'created_at'
    const sortOrder = order ?? 'desc'
    queryBuilder.orderBy(sortField, sortOrder)

    const paginated = await queryBuilder
      .preload('user')
      .preload('bookItems', (bookItemsQuery) => {
        bookItemsQuery.preload('authors')
      })
      .paginate(page, limit)
    const lists = paginated.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })
    return response.ok(lists)
  }

  async showTopBooks({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const topBooks = await user
      .related('topBooks')
      .query()
      .orderBy('users_top_books.position', 'asc')
      .preload('authors')
    return response.ok(topBooks)
  }

  async reorderTopBooks({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { bookIds } = await request.validateUsing(reorderTopBooksValidator)

    for (const [index, bookId] of bookIds.entries()) {
      const existingRelation = await db
        .from('users_top_books')
        .where('user_id', user.id)
        .where('book_id', bookId)
        .first()

      if (!existingRelation) {
        throw new AppError(`Book ID: ${bookId} not found in top books`, {
          status: 404,
          code: 'USER_TOP_NOT_FOUND',
        })
      }

      await db
        .from('users_top_books')
        .where('user_id', user.id)
        .where('book_id', bookId)
        .update({ position: index + 1, updated_at: new Date() })
    }

    return response.noContent()
  }

  async showMyActivity({ auth, request, response }: HttpContext) {
    const { page = 1, limit = 10 } = request.qs()
    const user = await auth.authenticate()
    const activity = await ActivityLog.query()
      .where('user_id', user.id)
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    // Enrichir les logs avec les ressources
    const enrichedData = await ActivityLogEnricher.enrich(activity.all())

    return response.ok({
      ...activity.toJSON(),
      data: enrichedData,
    })
  }

  async showUserActivity({ request, response }: HttpContext) {
    const { page = 1, limit = 10 } = request.qs()
    const { params } = await request.validateUsing(showSchema)
    const { username } = params
    const user = await User.query().where('username', username).first()

    if (!user) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }
    const activity = await ActivityLog.query()
      .where('user_id', user.id)
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    // Enrichir les logs avec les ressources
    const enrichedData = await ActivityLogEnricher.enrich(activity.all())

    return response.ok({
      ...activity.toJSON(),
      data: enrichedData,
    })
  }
}
