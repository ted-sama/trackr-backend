import type { HttpContext } from '@adonisjs/core/http'
import List from '#models/list'
import {
  showSchema,
  updateSchema,
  updateBackdropSchema,
  updateAvatarSchema,
  showListsQuerySchema,
} from '#validators/user'
import { reorderTopBooksValidator, setPinnedBookValidator } from '#validators/library'
import {
  activityFiltersSchema,
  VALID_ACTION_TYPES,
  type ActivityPeriod,
} from '#validators/activity'
import { cuid } from '@adonisjs/core/helpers'
import User from '#models/user'
import Book from '#models/book'
import db from '@adonisjs/lucid/services/db'
import AppError from '#exceptions/app_error'
import ActivityLog from '#models/activity_log'
import { ActivityLogEnricher } from '#services/activity_log_enricher'
import FollowService from '#services/follow_service'
import { DateTime } from 'luxon'

/**
 * Calculate date range start based on period filter
 */
function getDateRangeStart(period: ActivityPeriod): DateTime | null {
  const now = DateTime.now()
  switch (period) {
    case 'today':
      return now.startOf('day')
    case 'week':
      return now.startOf('week')
    case 'month':
      return now.startOf('month')
    case 'year':
      return now.startOf('year')
    case 'all':
    default:
      return null
  }
}

function enrichListWithUserContext(list: any, lists: List[], userId: string | null) {
  const listModel = lists.find((l) => l.id === list.id)
  if (listModel && userId) {
    list.isLikedByMe = listModel.isLikedBy(userId)
    list.isSavedByMe = listModel.isSavedBy(userId)
  } else {
    list.isLikedByMe = false
    list.isSavedByMe = false
  }
  return list
}

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

    // Get follow counts
    const counts = await FollowService.getCounts(user.id)

    const userData = user.serialize()
    userData.followersCount = counts.followersCount
    userData.followingCount = counts.followingCount

    return response.ok(userData)
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

  async show({ auth, request, response }: HttpContext) {
    const { params } = await request.validateUsing(showSchema)
    const { username } = params
    const userRecord = await User.query().where('username', username).first()

    if (!userRecord) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    const user = userRecord.serialize({
      fields: {
        pick: [
          'id',
          'username',
          'displayName',
          'bio',
          'avatar',
          'plan',
          'backdropMode',
          'backdropColor',
          'backdropImage',
          'isStatsPublic',
          'isActivityPublic',
          'isLibraryPublic',
          'createdAt',
        ],
      },
    })

    // Add follow counts
    const counts = await FollowService.getCounts(userRecord.id)
    user.followersCount = counts.followersCount
    user.followingCount = counts.followingCount

    // Add granular visibility levels
    user.statsVisibility = userRecord.statsVisibility
    user.activityVisibility = userRecord.activityVisibility
    user.libraryVisibility = userRecord.libraryVisibility
    user.connectionsVisibility = userRecord.connectionsVisibility

    // Add relationship info if authenticated
    const currentUser = (await auth.check()) ? auth.user : null
    if (currentUser && currentUser.id !== userRecord.id) {
      const relationship = await FollowService.getRelationship(currentUser.id, userRecord.id)
      user.isFollowedByMe = relationship.isFollowedByMe
      user.isFollowingMe = relationship.isFollowingMe
      user.isFriend = relationship.isFriend
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
      .preload('publishers')

    return response.ok(topBooks)
  }

  async showUserLists({ auth, request, response }: HttpContext) {
    const { params } = await request.validateUsing(showSchema)
    const { username } = params
    const {
      page = 1,
      limit = 10,
      sort,
      order,
      q,
    } = await request.validateUsing(showListsQuerySchema)
    const currentUser = auth.user ?? null

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
        bookItemsQuery.preload('authors').preload('publishers')
      })
      .preload('likedBy')
      .preload('savedBy')
      .paginate(page, limit)

    const serializedLists = paginated.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    serializedLists.data = serializedLists.data.map((list: any) =>
      enrichListWithUserContext(list, paginated.all(), currentUser?.id ?? null)
    )

    return response.ok(serializedLists)
  }

  async update({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const {
      username,
      displayName,
      bio,
      backdropMode,
      backdropColor,
      isStatsPublic,
      isActivityPublic,
      isLibraryPublic,
      statsVisibility,
      activityVisibility,
      libraryVisibility,
      connectionsVisibility,
    } = await request.validateUsing(updateSchema)

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

    // Update privacy preferences if provided
    const hasLegacyUpdates =
      isStatsPublic !== undefined || isActivityPublic !== undefined || isLibraryPublic !== undefined
    const hasGranularUpdates =
      statsVisibility !== undefined ||
      activityVisibility !== undefined ||
      libraryVisibility !== undefined ||
      connectionsVisibility !== undefined

    if (hasLegacyUpdates || hasGranularUpdates) {
      const privacyUpdates: Record<string, boolean | string> = {}

      // Legacy boolean fields
      if (isStatsPublic !== undefined) privacyUpdates.statsPublic = isStatsPublic
      if (isActivityPublic !== undefined) privacyUpdates.activityPublic = isActivityPublic
      if (isLibraryPublic !== undefined) privacyUpdates.libraryPublic = isLibraryPublic

      // Granular visibility fields
      if (statsVisibility !== undefined) privacyUpdates.statsVisibility = statsVisibility
      if (activityVisibility !== undefined) privacyUpdates.activityVisibility = activityVisibility
      if (libraryVisibility !== undefined) privacyUpdates.libraryVisibility = libraryVisibility
      if (connectionsVisibility !== undefined) privacyUpdates.connectionsVisibility = connectionsVisibility

      user.setPrivacyPreferences(privacyUpdates)
    }

    await user
      .merge({
        username,
        displayName,
        bio,
        backdropMode,
        backdropColor,
      })
      .save()
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

    // Check if user is trying to upload a GIF without Plus subscription
    const isGif = avatar.extname?.toLowerCase() === 'gif'
    if (isGif && user.plan !== 'plus') {
      throw new AppError('GIF avatars are only available for Trackr Plus subscribers', {
        status: 403,
        code: 'USER_AVATAR_GIF_PLUS_REQUIRED',
        // meta: {
        //   requiredPlan: 'plus',
        //   currentPlan: user.plan,
        // },
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

    // Check if user has Plus subscription for backdrop images
    if (user.plan !== 'plus') {
      throw new AppError('Image backdrops are only available for Trackr Plus subscribers', {
        status: 403,
        code: 'USER_BACKDROP_PLUS_REQUIRED',
        // meta: {
        //   requiredPlan: 'plus',
        //   currentPlan: user.plan,
        // },
      })
    }

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

    const queryBuilder = List.query().where((builder) => {
      builder.where('user_id', user.id).orWhereHas('savedBy', (savedByQuery) => {
        savedByQuery.where('users.id', user.id)
      })
    })

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
        bookItemsQuery.preload('authors').preload('publishers')
      })
      .preload('likedBy')
      .preload('savedBy')
      .paginate(page, limit)

    const serializedLists = paginated.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    serializedLists.data = serializedLists.data.map((list: any) =>
      enrichListWithUserContext(list, paginated.all(), user.id)
    )

    return response.ok(serializedLists)
  }

  async showTopBooks({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const topBooks = await user
      .related('topBooks')
      .query()
      .orderBy('users_top_books.position', 'asc')
      .preload('authors')
      .preload('publishers')
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
    const { page = 1, limit = 10, sort = 'recent', period = 'all', actions } = request.qs()

    // Validate filters
    await request.validateUsing(activityFiltersSchema)

    const user = await auth.authenticate()

    // Build query with filters
    let query = ActivityLog.query().where('user_id', user.id)

    // Apply period filter
    if (period && period !== 'all') {
      const dateStart = getDateRangeStart(period)
      if (dateStart) {
        query = query.where('created_at', '>=', dateStart.toJSDate())
      }
    }

    // Apply action types filter
    if (actions && Array.isArray(actions) && actions.length > 0) {
      // Filter only valid action types
      const validActions = actions.filter((a: string) =>
        VALID_ACTION_TYPES.includes(a as (typeof VALID_ACTION_TYPES)[number])
      )
      if (validActions.length > 0) {
        query = query.whereIn('action', validActions)
      }
    }

    // Apply sort order
    query = query.orderBy('created_at', sort === 'oldest' ? 'asc' : 'desc')

    const activity = await query.paginate(page, limit)

    // Enrichir les logs avec les ressources
    const enrichedData = await ActivityLogEnricher.enrich(activity.all())

    return response.ok({
      ...activity.toJSON(),
      data: enrichedData,
    })
  }

  async showUserActivity({ auth, request, response }: HttpContext) {
    const { page = 1, limit = 10, sort = 'recent', period = 'all', actions } = request.qs()

    // Validate filters
    await request.validateUsing(activityFiltersSchema)

    const { params } = await request.validateUsing(showSchema)
    const { username } = params
    const user = await User.query().where('username', username).first()

    if (!user) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    // Check if current user can view activity based on visibility settings
    const currentUser = (await auth.check()) ? auth.user : null
    const canView = await FollowService.canViewContent(
      currentUser?.id ?? null,
      user.id,
      user.activityVisibility
    )

    if (!canView) {
      throw new AppError("This user's activity is private", {
        status: 403,
        code: 'ACTIVITY_PRIVATE',
      })
    }

    // Build query with filters
    let query = ActivityLog.query().where('user_id', user.id)

    // Apply period filter
    if (period && period !== 'all') {
      const dateStart = getDateRangeStart(period)
      if (dateStart) {
        query = query.where('created_at', '>=', dateStart.toJSDate())
      }
    }

    // Apply action types filter
    if (actions && Array.isArray(actions) && actions.length > 0) {
      // Filter only valid action types
      const validActions = actions.filter((a: string) =>
        VALID_ACTION_TYPES.includes(a as (typeof VALID_ACTION_TYPES)[number])
      )
      if (validActions.length > 0) {
        query = query.whereIn('action', validActions)
      }
    }

    // Apply sort order
    query = query.orderBy('created_at', sort === 'oldest' ? 'asc' : 'desc')

    const activity = await query.paginate(page, limit)

    // Enrichir les logs avec les ressources
    const enrichedData = await ActivityLogEnricher.enrich(activity.all())

    return response.ok({
      ...activity.toJSON(),
      data: enrichedData,
    })
  }

  /**
   * @summary Register push notification token
   * @tag Users
   * @description Registers an Expo push token for the authenticated user
   * @requestBody { "pushToken": "ExponentPushToken[xxx]" }
   * @responseBody 204 - Token registered successfully
   * @responseBody 401 - Unauthorized
   */
  async registerPushToken({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { pushToken } = request.only(['pushToken'])

    if (pushToken && typeof pushToken === 'string') {
      await user.merge({ pushToken }).save()
    }

    return response.noContent()
  }

  /**
   * @summary Get notification settings
   * @tag Users
   * @description Returns the authenticated user's notification preferences
   * @responseBody 200 - Notification settings
   * @responseBody 401 - Unauthorized
   */
  async getNotificationSettings({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    return response.ok({
      notifyReviewLikes: user.notifyReviewLikes,
      notifyListLikes: user.notifyListLikes,
      notifyListSaves: user.notifyListSaves,
      notifyNewFollower: user.notifyNewFollower,
      notifyNewFriend: user.notifyNewFriend,
    })
  }

  /**
   * @summary Update notification settings
   * @tag Users
   * @description Updates the authenticated user's notification preferences
   * @requestBody { "notifyReviewLikes": true, "notifyListLikes": true, "notifyListSaves": true, "notifyNewFollower": true, "notifyNewFriend": true }
   * @responseBody 200 - Updated notification settings
   * @responseBody 401 - Unauthorized
   */
  async updateNotificationSettings({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { notifyReviewLikes, notifyListLikes, notifyListSaves, notifyNewFollower, notifyNewFriend } = request.only([
      'notifyReviewLikes',
      'notifyListLikes',
      'notifyListSaves',
      'notifyNewFollower',
      'notifyNewFriend',
    ])

    const updates: Record<string, boolean> = {}

    if (typeof notifyReviewLikes === 'boolean') {
      updates.reviewLikes = notifyReviewLikes
    }
    if (typeof notifyListLikes === 'boolean') {
      updates.listLikes = notifyListLikes
    }
    if (typeof notifyListSaves === 'boolean') {
      updates.listSaves = notifyListSaves
    }
    if (typeof notifyNewFollower === 'boolean') {
      updates.newFollower = notifyNewFollower
    }
    if (typeof notifyNewFriend === 'boolean') {
      updates.newFriend = notifyNewFriend
    }

    user.setNotificationPreferences(updates)
    await user.save()

    return response.ok({
      notifyReviewLikes: user.notifyReviewLikes,
      notifyListLikes: user.notifyListLikes,
      notifyListSaves: user.notifyListSaves,
      notifyNewFollower: user.notifyNewFollower,
      notifyNewFriend: user.notifyNewFriend,
    })
  }

  /**
   * @summary Delete current user account
   * @tag Users
   * @description Permanently deletes the authenticated user's account and all associated data
   * @responseBody 204 - Account deleted successfully
   * @responseBody 401 - Unauthorized
   */
  async deleteAccount({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    // Delete the user - cascading will handle:
    // - access_tokens (auth_access_tokens.tokenable_id -> users.id)
    // - lists (lists.user_id -> users.id)
    // - book_trackings (book_trackings.user_id -> users.id)
    // - book_reviews (book_reviews.user_id -> users.id)
    // - password_reset_tokens (password_reset_tokens.user_id -> users.id)
    // - activity_logs (activity_logs.user_id -> users.id)
    // - reports (reports.reporter_id -> users.id)
    // - users_top_books (users_top_books.user_id -> users.id)
    // Note: S3 files (avatar, backdrop) are left orphaned - can be cleaned up via a separate process
    await user.delete()

    return response.noContent()
  }

  /**
   * @summary Get pinned book
   * @tag Users
   * @description Returns the authenticated user's pinned book with tracking info
   * @responseBody 200 - Pinned book data with tracking
   * @responseBody 401 - Unauthorized
   */
  async getPinnedBook({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    if (!user.pinnedBookId) {
      return response.ok({ book: null, tracking: null })
    }

    await user.load('pinnedBook', (query) => {
      query.preload('authors').preload('publishers')
    })

    if (!user.pinnedBook) {
      return response.ok({ book: null, tracking: null })
    }

    // Get tracking info for this book
    const tracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', user.pinnedBookId)
      .first()

    return response.ok({
      book: user.pinnedBook,
      tracking: tracking
        ? {
            status: tracking.status,
            currentChapter: tracking.currentChapter,
            currentVolume: tracking.currentVolume,
            rating: tracking.rating,
            startDate: tracking.startDate,
            finishDate: tracking.finishDate,
            lastReadAt: tracking.lastReadAt,
          }
        : null,
    })
  }

  /**
   * @summary Set pinned book
   * @tag Users
   * @description Pin a book to the home screen (Trackr Plus only)
   * @responseBody 201 - Book pinned successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Trackr Plus required
   * @responseBody 404 - Book not found
   */
  async setPinnedBook({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()

    // Check if user has Plus subscription
    if (user.plan !== 'plus') {
      throw new AppError('Pinning a book requires Trackr Plus', {
        status: 403,
        code: 'USER_PLUS_REQUIRED',
      })
    }

    const { params } = await request.validateUsing(setPinnedBookValidator)
    const { bookId } = params

    // Check if book exists
    const book = await Book.find(bookId)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    // Pin the book
    await user.merge({ pinnedBookId: bookId }).save()

    // Return the pinned book with tracking
    await user.load('pinnedBook', (query) => {
      query.preload('authors').preload('publishers')
    })

    const tracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', bookId)
      .first()

    return response.created({
      book: user.pinnedBook,
      tracking: tracking
        ? {
            status: tracking.status,
            currentChapter: tracking.currentChapter,
            currentVolume: tracking.currentVolume,
            rating: tracking.rating,
            startDate: tracking.startDate,
            finishDate: tracking.finishDate,
            lastReadAt: tracking.lastReadAt,
          }
        : null,
    })
  }

  /**
   * @summary Remove pinned book
   * @tag Users
   * @description Unpin the currently pinned book from home screen
   * @responseBody 204 - Book unpinned successfully
   * @responseBody 401 - Unauthorized
   */
  async removePinnedBook({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    if (user.pinnedBookId) {
      await user.merge({ pinnedBookId: null }).save()
    }

    return response.noContent()
  }
}
