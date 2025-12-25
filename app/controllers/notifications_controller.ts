import type { HttpContext } from '@adonisjs/core/http'
import NotificationService from '#services/notification_service'
import type Notification from '#models/notification'

export default class NotificationsController {
  /**
   * GET /notifications
   * Paginated list of notifications
   */
  async index({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)

    const notifications = await NotificationService.getUserNotifications(user.id, page, limit)

    return response.ok({
      data: notifications.all().map((n) => this.serializeNotification(n)),
      meta: notifications.getMeta(),
    })
  }

  /**
   * GET /notifications/unread-count
   * Number of unread notifications
   */
  async unreadCount({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const count = await NotificationService.getUnreadCount(user.id)
    return response.ok({ count })
  }

  /**
   * PATCH /notifications/:id/read
   * Mark a notification as read
   */
  async markAsRead({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()
    const success = await NotificationService.markAsRead(params.id, user.id)

    if (!success) {
      return response.notFound({ message: 'Notification not found' })
    }

    return response.ok({ success: true })
  }

  /**
   * POST /notifications/read-all
   * Mark all notifications as read
   */
  async markAllAsRead({ auth, response }: HttpContext) {
    const user = await auth.authenticate()
    await NotificationService.markAllAsRead(user.id)
    return response.ok({ success: true })
  }

  private serializeNotification(notification: Notification) {
    return {
      id: notification.id,
      type: notification.type,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      read: notification.read,
      createdAt: notification.createdAt.toISO(),
      actor: {
        id: notification.actor.id,
        username: notification.actor.username,
        displayName: notification.actor.displayName,
        avatar: notification.actor.avatar,
      },
      resource: this.serializeResource(notification),
    }
  }

  private serializeResource(notification: Notification) {
    if (!notification.resource) return null

    if (notification.resourceType === 'book_review') {
      return {
        id: notification.resource.id,
        content: notification.resource.content?.substring(0, 100),
        rating: notification.resource.rating,
        book: notification.resource.book
          ? {
              id: notification.resource.book.id,
              title: notification.resource.book.title,
              cover: notification.resource.book.cover,
            }
          : null,
      }
    }

    if (notification.resourceType === 'list') {
      return {
        id: notification.resource.id,
        name: notification.resource.name,
      }
    }

    return null
  }
}
