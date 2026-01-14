import Notification, { type NotificationType, type ResourceType } from '#models/notification'
import BookReview from '#models/book_review'
import List from '#models/list'
import User from '#models/user'
import PushNotificationService from '#services/push_notification_service'
import CacheService from '#services/cache_service'

// Cooldown duration in seconds (24 hours)
const NOTIFICATION_COOLDOWN_SECONDS = 24 * 60 * 60

interface CreateNotificationData {
  userId: string // Recipient
  actorId: string // Who did the action
  type: NotificationType
  resourceType: ResourceType
  resourceId: string | number
}

export default class NotificationService {
  /**
   * Creates a notification (avoids self-notifications and duplicates)
   * In-app notifications are always created, push notifications respect user preferences
   */
  static async create(data: CreateNotificationData): Promise<Notification | null> {
    // Don't notify user of their own actions
    if (data.userId === data.actorId) {
      return null
    }

    try {
      // Always create in-app notification
      const notification = await Notification.updateOrCreate(
        {
          userId: data.userId,
          actorId: data.actorId,
          type: data.type,
          resourceType: data.resourceType,
          resourceId: data.resourceId.toString(),
        },
        {
          read: false, // Reset to unread if it's an update
        }
      )

      // Send push notification only if user wants it (check preferences)
      this.sendPushNotificationIfAllowed(data, notification.id).catch((err) => {
        console.error('Failed to send push notification:', err)
      })

      return notification
    } catch (error) {
      console.error('Failed to create notification:', error)
      return null
    }
  }

  /**
   * Generates a unique cooldown key for a notification
   */
  private static getCooldownKey(data: CreateNotificationData): string {
    return `notification:cooldown:${data.userId}:${data.actorId}:${data.type}:${data.resourceType}:${data.resourceId}`
  }

  /**
   * Checks if a notification is in cooldown period
   * Returns true if notification should be blocked (cooldown active)
   */
  private static async isInCooldown(data: CreateNotificationData): Promise<boolean> {
    const key = this.getCooldownKey(data)
    return CacheService.exists(key)
  }

  /**
   * Sets a cooldown for a notification
   */
  private static async setCooldown(data: CreateNotificationData): Promise<void> {
    const key = this.getCooldownKey(data)
    await CacheService.set(key, Date.now(), NOTIFICATION_COOLDOWN_SECONDS)
  }

  /**
   * Sends push notification only if user has enabled this notification type
   * and the notification is not in cooldown period
   */
  private static async sendPushNotificationIfAllowed(
    data: CreateNotificationData,
    notificationId: string
  ): Promise<void> {
    const recipient = await User.find(data.userId)
    if (!recipient) {
      return
    }

    // Check if user wants push notifications for this type
    const wantsPush = this.checkUserPreference(recipient, data.type)
    if (!wantsPush) {
      return
    }

    // Check cooldown to prevent spam (e.g., follow/unfollow spam)
    const inCooldown = await this.isInCooldown(data)
    if (inCooldown) {
      console.log(`Notification cooldown active for ${this.getCooldownKey(data)}`)
      return
    }

    // Set cooldown before sending to prevent race conditions
    await this.setCooldown(data)

    await this.sendPushNotification(data, notificationId)
  }

  /**
   * Checks if user wants to receive a specific notification type
   */
  private static checkUserPreference(user: User, type: NotificationType): boolean {
    switch (type) {
      case 'review_like':
        return user.notifyReviewLikes
      case 'list_like':
        return user.notifyListLikes
      case 'list_save':
        return user.notifyListSaves
      case 'new_follower':
        return user.notifyNewFollower
      case 'new_friend':
        return user.notifyNewFriend
      default:
        return true
    }
  }

  /**
   * Sends a push notification for the given notification data
   */
  private static async sendPushNotification(
    data: CreateNotificationData,
    notificationId: string
  ): Promise<void> {
    const actor = await User.find(data.actorId)
    if (!actor) return

    const actorName = actor.displayName || actor.username

    let body = ''
    let resourceName = ''

    // Get resource name for context
    if (data.resourceType === 'book_review') {
      const review = await BookReview.query()
        .where('id', Number(data.resourceId))
        .preload('book')
        .first()
      resourceName = review?.book?.title || ''
    } else if (data.resourceType === 'list') {
      const list = await List.find(Number(data.resourceId))
      resourceName = list?.name || ''
    }

    // Build notification message
    switch (data.type) {
      case 'review_like':
        body = resourceName
          ? `${actorName} liked your review of ${resourceName}`
          : `${actorName} liked your review`
        break
      case 'list_like':
        body = resourceName
          ? `${actorName} liked your list ${resourceName}`
          : `${actorName} liked your list`
        break
      case 'list_save':
        body = resourceName
          ? `${actorName} saved your list ${resourceName}`
          : `${actorName} saved your list`
        break
      case 'new_follower':
        body = `${actorName} started following you`
        break
      case 'new_friend':
        body = `You and ${actorName} are now friends!`
        break
      default:
        body = `${actorName} interacted with your content`
    }

    await PushNotificationService.sendToUser(data.userId, {
      title: 'Trackr',
      body,
      data: {
        notificationId,
        type: data.type,
        resourceType: data.resourceType,
        resourceId: data.resourceId.toString(),
      },
    })
  }

  /**
   * Deletes a notification (when unliking for example)
   */
  static async delete(
    data: Omit<CreateNotificationData, 'type'> & { type: NotificationType }
  ): Promise<void> {
    try {
      await Notification.query()
        .where('userId', data.userId)
        .where('actorId', data.actorId)
        .where('type', data.type)
        .where('resourceType', data.resourceType)
        .where('resourceId', data.resourceId.toString())
        .delete()
    } catch (error) {
      console.error('Failed to delete notification:', error)
    }
  }

  /**
   * Gets a user's notifications with pagination
   */
  static async getUserNotifications(userId: string, page: number = 1, limit: number = 20) {
    const notifications = await Notification.query()
      .where('userId', userId)
      .preload('actor')
      .orderBy('createdAt', 'desc')
      .paginate(page, limit)

    // Enrich with resources
    await this.enrichNotifications(notifications.all())

    return notifications
  }

  /**
   * Counts unread notifications
   */
  static async getUnreadCount(userId: string): Promise<number> {
    const result = await Notification.query()
      .where('userId', userId)
      .where('read', false)
      .count('* as total')
      .first()

    return Number(result?.$extras.total || 0)
  }

  /**
   * Marks a notification as read
   */
  static async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const affected = await Notification.query()
      .where('id', notificationId)
      .where('userId', userId)
      .update({ read: true })

    return affected.length > 0
  }

  /**
   * Marks all notifications as read
   */
  static async markAllAsRead(userId: string): Promise<void> {
    await Notification.query().where('userId', userId).where('read', false).update({ read: true })
  }

  /**
   * Enriches notifications with their resources
   */
  private static async enrichNotifications(notifications: Notification[]): Promise<void> {
    // Group by resource type
    const reviewIds = notifications
      .filter((n) => n.resourceType === 'book_review')
      .map((n) => Number(n.resourceId))

    const listIds = notifications
      .filter((n) => n.resourceType === 'list')
      .map((n) => Number(n.resourceId))

    // Load in batch
    const [reviews, lists] = await Promise.all([
      reviewIds.length > 0
        ? BookReview.query().whereIn('id', reviewIds).preload('book')
        : Promise.resolve([]),
      listIds.length > 0 ? List.query().whereIn('id', listIds) : Promise.resolve([]),
    ])

    // Create maps for quick lookup
    const reviewMap = new Map(reviews.map((r) => [r.id.toString(), r]))
    const listMap = new Map(lists.map((l) => [l.id.toString(), l]))

    // Attach resources
    for (const notification of notifications) {
      if (notification.resourceType === 'book_review') {
        notification.resource = reviewMap.get(notification.resourceId)
      } else if (notification.resourceType === 'list') {
        notification.resource = listMap.get(notification.resourceId)
      }
    }
  }
}
