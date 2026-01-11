import User, { type VisibilityLevel } from '#models/user'
import db from '@adonisjs/lucid/services/db'
import NotificationService from '#services/notification_service'

interface FollowResult {
  isMutual: boolean
}

interface FollowCounts {
  followersCount: number
  followingCount: number
}

export default class FollowService {
  /**
   * Follow a user
   * Creates notification and checks for mutual follow
   */
  static async follow(followerId: string, followingId: string): Promise<FollowResult> {
    // Cannot follow yourself
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself')
    }

    // Check if already following
    const existing = await db
      .from('user_follows')
      .where('follower_id', followerId)
      .where('following_id', followingId)
      .first()

    if (existing) {
      // Already following, check if mutual
      const isMutual = await this.areFriends(followerId, followingId)
      return { isMutual }
    }

    // Create follow relationship
    await db.table('user_follows').insert({
      follower_id: followerId,
      following_id: followingId,
      created_at: new Date(),
    })

    // Check if this creates a mutual follow (friendship)
    const isMutual = await this.isFollowing(followingId, followerId)

    // Send notification to the followed user
    await NotificationService.create({
      userId: followingId,
      actorId: followerId,
      type: 'new_follower',
      resourceType: 'user',
      resourceId: followerId,
    })

    // If mutual, send "new friend" notification to the follower (who just created the mutual)
    if (isMutual) {
      await NotificationService.create({
        userId: followerId,
        actorId: followingId,
        type: 'new_friend',
        resourceType: 'user',
        resourceId: followingId,
      })
      // Also notify the other user about the new friendship
      await NotificationService.create({
        userId: followingId,
        actorId: followerId,
        type: 'new_friend',
        resourceType: 'user',
        resourceId: followerId,
      })
    }

    return { isMutual }
  }

  /**
   * Unfollow a user
   */
  static async unfollow(followerId: string, followingId: string): Promise<void> {
    await db
      .from('user_follows')
      .where('follower_id', followerId)
      .where('following_id', followingId)
      .delete()

    // Remove follow notification
    await NotificationService.delete({
      userId: followingId,
      actorId: followerId,
      type: 'new_follower',
      resourceType: 'user',
      resourceId: followerId,
    })
  }

  /**
   * Check if user A follows user B
   */
  static async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const result = await db
      .from('user_follows')
      .where('follower_id', followerId)
      .where('following_id', followingId)
      .first()

    return !!result
  }

  /**
   * Check if two users are mutual followers (friends)
   */
  static async areFriends(userAId: string, userBId: string): Promise<boolean> {
    const [aFollowsB, bFollowsA] = await Promise.all([
      this.isFollowing(userAId, userBId),
      this.isFollowing(userBId, userAId),
    ])

    return aFollowsB && bFollowsA
  }

  /**
   * Get relationship info between viewer and target user
   */
  static async getRelationship(
    viewerId: string,
    targetId: string
  ): Promise<{ isFollowedByMe: boolean; isFollowingMe: boolean; isFriend: boolean }> {
    const [isFollowedByMe, isFollowingMe] = await Promise.all([
      this.isFollowing(viewerId, targetId),
      this.isFollowing(targetId, viewerId),
    ])

    return {
      isFollowedByMe,
      isFollowingMe,
      isFriend: isFollowedByMe && isFollowingMe,
    }
  }

  /**
   * Get followers of a user with pagination
   */
  static async getFollowers(userId: string, page: number = 1, limit: number = 20) {
    return User.query()
      .whereIn('id', (subquery) => {
        subquery.from('user_follows').select('follower_id').where('following_id', userId)
      })
      .orderBy('created_at', 'desc')
      .paginate(page, limit)
  }

  /**
   * Get users that a user is following with pagination
   */
  static async getFollowing(userId: string, page: number = 1, limit: number = 20) {
    return User.query()
      .whereIn('id', (subquery) => {
        subquery.from('user_follows').select('following_id').where('follower_id', userId)
      })
      .orderBy('created_at', 'desc')
      .paginate(page, limit)
  }

  /**
   * Get follower and following counts for a user
   */
  static async getCounts(userId: string): Promise<FollowCounts> {
    const [followersResult, followingResult] = await Promise.all([
      db.from('user_follows').where('following_id', userId).count('* as count').first(),
      db.from('user_follows').where('follower_id', userId).count('* as count').first(),
    ])

    return {
      followersCount: Number(followersResult?.count || 0),
      followingCount: Number(followingResult?.count || 0),
    }
  }

  /**
   * Get list of user IDs that a user is following
   */
  static async getFollowingIds(userId: string): Promise<string[]> {
    const results = await db
      .from('user_follows')
      .select('following_id')
      .where('follower_id', userId)

    return results.map((r) => r.following_id)
  }

  /**
   * Check if viewer can access content based on visibility level
   */
  static async canViewContent(
    viewerId: string | null,
    ownerId: string,
    visibility: VisibilityLevel
  ): Promise<boolean> {
    // Owner can always view their own content
    if (viewerId === ownerId) {
      return true
    }

    switch (visibility) {
      case 'public':
        return true

      case 'followers':
        if (!viewerId) return false
        return this.isFollowing(viewerId, ownerId)

      case 'friends':
        if (!viewerId) return false
        return this.areFriends(viewerId, ownerId)

      case 'private':
        return false

      default:
        return false
    }
  }
}
