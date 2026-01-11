import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import AppError from '#exceptions/app_error'
import FollowService from '#services/follow_service'

export default class FollowsController {
  /**
   * @summary Follow a user
   * @tag Follows
   * @description Follow another user by their username
   * @responseBody 200 - { message: 'Followed', isMutual: boolean }
   * @responseBody 400 - Cannot follow yourself
   * @responseBody 404 - User not found
   * @responseBody 401 - Unauthorized
   */
  async follow({ auth, params, response }: HttpContext) {
    const currentUser = await auth.authenticate()
    const { username } = params

    const targetUser = await User.findBy('username', username)

    if (!targetUser) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    if (targetUser.id === currentUser.id) {
      throw new AppError('Cannot follow yourself', {
        status: 400,
        code: 'CANNOT_FOLLOW_SELF',
      })
    }

    const result = await FollowService.follow(currentUser.id, targetUser.id)

    return response.ok({
      message: 'Followed',
      isMutual: result.isMutual,
    })
  }

  /**
   * @summary Unfollow a user
   * @tag Follows
   * @description Unfollow a user by their username
   * @responseBody 200 - { message: 'Unfollowed' }
   * @responseBody 404 - User not found
   * @responseBody 401 - Unauthorized
   */
  async unfollow({ auth, params, response }: HttpContext) {
    const currentUser = await auth.authenticate()
    const { username } = params

    const targetUser = await User.findBy('username', username)

    if (!targetUser) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    await FollowService.unfollow(currentUser.id, targetUser.id)

    return response.ok({
      message: 'Unfollowed',
    })
  }

  /**
   * @summary Get followers of a user
   * @tag Follows
   * @description Get paginated list of users who follow the specified user
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 50) - @type(number)
   * @responseBody 200 - <User[]>.paginated()
   * @responseBody 404 - User not found
   */
  async getFollowers({ auth, params, request, response }: HttpContext) {
    const { username } = params
    const page = request.input('page', 1)
    const limit = Math.min(request.input('limit', 20), 50)

    const targetUser = await User.findBy('username', username)

    if (!targetUser) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    const currentUser = (await auth.check()) ? auth.user : null
    const followers = await FollowService.getFollowers(targetUser.id, page, limit)

    // Enrich with relationship data if authenticated
    const serialized = followers.serialize({
      fields: {
        pick: ['id', 'username', 'displayName', 'avatar', 'plan', 'createdAt'],
      },
    })

    if (currentUser) {
      // Add relationship info for each follower
      for (const userData of serialized.data) {
        const relationship = await FollowService.getRelationship(currentUser.id, userData.id)
        userData.isFollowedByMe = relationship.isFollowedByMe
        userData.isFollowingMe = relationship.isFollowingMe
        userData.isFriend = relationship.isFriend
      }
    }

    return response.ok(serialized)
  }

  /**
   * @summary Get users that a user is following
   * @tag Follows
   * @description Get paginated list of users that the specified user follows
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 50) - @type(number)
   * @responseBody 200 - <User[]>.paginated()
   * @responseBody 404 - User not found
   */
  async getFollowing({ auth, params, request, response }: HttpContext) {
    const { username } = params
    const page = request.input('page', 1)
    const limit = Math.min(request.input('limit', 20), 50)

    const targetUser = await User.findBy('username', username)

    if (!targetUser) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    const currentUser = (await auth.check()) ? auth.user : null
    const following = await FollowService.getFollowing(targetUser.id, page, limit)

    const serialized = following.serialize({
      fields: {
        pick: ['id', 'username', 'displayName', 'avatar', 'plan', 'createdAt'],
      },
    })

    if (currentUser) {
      for (const userData of serialized.data) {
        const relationship = await FollowService.getRelationship(currentUser.id, userData.id)
        userData.isFollowedByMe = relationship.isFollowedByMe
        userData.isFollowingMe = relationship.isFollowingMe
        userData.isFriend = relationship.isFriend
      }
    }

    return response.ok(serialized)
  }

  /**
   * @summary Get current user's followers
   * @tag Follows
   * @description Get paginated list of users who follow the authenticated user
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 50) - @type(number)
   * @responseBody 200 - <User[]>.paginated()
   * @responseBody 401 - Unauthorized
   */
  async getMyFollowers({ auth, request, response }: HttpContext) {
    const currentUser = await auth.authenticate()
    const page = request.input('page', 1)
    const limit = Math.min(request.input('limit', 20), 50)

    const followers = await FollowService.getFollowers(currentUser.id, page, limit)

    const serialized = followers.serialize({
      fields: {
        pick: ['id', 'username', 'displayName', 'avatar', 'plan', 'createdAt'],
      },
    })

    // Add relationship info
    for (const userData of serialized.data) {
      const relationship = await FollowService.getRelationship(currentUser.id, userData.id)
      userData.isFollowedByMe = relationship.isFollowedByMe
      userData.isFollowingMe = relationship.isFollowingMe
      userData.isFriend = relationship.isFriend
    }

    return response.ok(serialized)
  }

  /**
   * @summary Get users the current user is following
   * @tag Follows
   * @description Get paginated list of users that the authenticated user follows
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 50) - @type(number)
   * @responseBody 200 - <User[]>.paginated()
   * @responseBody 401 - Unauthorized
   */
  async getMyFollowing({ auth, request, response }: HttpContext) {
    const currentUser = await auth.authenticate()
    const page = request.input('page', 1)
    const limit = Math.min(request.input('limit', 20), 50)

    const following = await FollowService.getFollowing(currentUser.id, page, limit)

    const serialized = following.serialize({
      fields: {
        pick: ['id', 'username', 'displayName', 'avatar', 'plan', 'createdAt'],
      },
    })

    // Add relationship info
    for (const userData of serialized.data) {
      const relationship = await FollowService.getRelationship(currentUser.id, userData.id)
      userData.isFollowedByMe = relationship.isFollowedByMe
      userData.isFollowingMe = relationship.isFollowingMe
      userData.isFriend = relationship.isFriend
    }

    return response.ok(serialized)
  }
}
