import Notification from '#models/notification'
import User from '#models/user'
import PushNotificationService from '#services/push_notification_service'
import moderationConfig from '#config/moderation'

export interface ModerationNotificationData {
  userId: string
  reason?: string
  resourceType?: string
  resourceId?: string
  duration?: number // days
  strikeCount?: number
}

/**
 * Service for sending moderation-related notifications
 */
export default class ModerationNotificationService {
  /**
   * Notify user that their content was moderated (censored/deleted)
   */
  static async notifyContentModerated(
    userId: string,
    resourceType: string,
    action: 'censored' | 'deleted',
    reason: string
  ): Promise<void> {
    if (!moderationConfig.notifications.notifyUserOnModeration) {
      return
    }

    try {
      // Create in-app notification
      // Using a system user ID or the moderated user as actor for self-notification
      await Notification.create({
        userId,
        actorId: userId, // Self-notification for moderation
        type: 'content_moderated',
        resourceType: 'moderation',
        resourceId: resourceType, // Use resource type as identifier
        read: false,
      })

      // Send push notification
      const user = await User.find(userId)
      if (user?.pushToken) {
        const actionText = action === 'censored' ? 'censored' : 'removed'
        await PushNotificationService.sendToUser(userId, {
          title: 'Content Moderated',
          body: `Your ${resourceType.replace('_', ' ')} was ${actionText} for ${reason}.`,
          data: {
            type: 'content_moderated',
            resourceType,
            action,
            reason,
          },
        })
      }
    } catch (error) {
      console.error('Failed to send content moderation notification:', error)
    }
  }

  /**
   * Notify user that they received a strike/warning
   */
  static async notifyStrikeReceived(
    userId: string,
    strikeCount: number,
    reason: string
  ): Promise<void> {
    if (!moderationConfig.notifications.notifyUserOnModeration) {
      return
    }

    try {
      await Notification.create({
        userId,
        actorId: userId,
        type: 'strike_received',
        resourceType: 'moderation',
        resourceId: `strike_${strikeCount}`,
        read: false,
      })

      const user = await User.find(userId)
      if (user?.pushToken) {
        const { strikes } = moderationConfig
        const strikesUntilTempBan = strikes.tempBanThreshold - strikeCount
        const strikesUntilPermBan = strikes.permaBanThreshold - strikeCount

        let warningMessage = ''
        if (strikesUntilTempBan > 0) {
          warningMessage = `${strikesUntilTempBan} more strike(s) until temporary suspension.`
        } else if (strikesUntilPermBan > 0) {
          warningMessage = `${strikesUntilPermBan} more strike(s) until permanent suspension.`
        }

        await PushNotificationService.sendToUser(userId, {
          title: 'Account Warning',
          body: `You received a warning for ${reason}. Total strikes: ${strikeCount}. ${warningMessage}`,
          data: {
            type: 'strike_received',
            strikeCount,
            reason,
          },
        })
      }
    } catch (error) {
      console.error('Failed to send strike notification:', error)
    }
  }

  /**
   * Notify user that their account was banned
   */
  static async notifyAccountBanned(
    userId: string,
    durationDays: number | null, // null = permanent
    reason: string
  ): Promise<void> {
    if (!moderationConfig.notifications.notifyUserOnModeration) {
      return
    }

    try {
      await Notification.create({
        userId,
        actorId: userId,
        type: 'account_banned',
        resourceType: 'moderation',
        resourceId: durationDays ? `temp_${durationDays}` : 'permanent',
        read: false,
      })

      const user = await User.find(userId)
      if (user?.pushToken) {
        const isPermanent = durationDays === null

        await PushNotificationService.sendToUser(userId, {
          title: isPermanent ? 'Account Permanently Suspended' : 'Account Temporarily Suspended',
          body: isPermanent
            ? `Your account has been permanently suspended for ${reason}.`
            : `Your account has been suspended for ${durationDays} days for ${reason}.`,
          data: {
            type: 'account_banned',
            isPermanent,
            durationDays,
            reason,
          },
        })
      }
    } catch (error) {
      console.error('Failed to send ban notification:', error)
    }
  }

  /**
   * Notify user that their account was unbanned
   */
  static async notifyAccountUnbanned(userId: string): Promise<void> {
    if (!moderationConfig.notifications.notifyUserOnModeration) {
      return
    }

    try {
      await Notification.create({
        userId,
        actorId: userId,
        type: 'account_unbanned',
        resourceType: 'moderation',
        resourceId: 'unbanned',
        read: false,
      })

      const user = await User.find(userId)
      if (user?.pushToken) {
        await PushNotificationService.sendToUser(userId, {
          title: 'Account Restored',
          body: 'Your account has been restored. Please follow community guidelines to avoid future suspensions.',
          data: {
            type: 'account_unbanned',
          },
        })
      }
    } catch (error) {
      console.error('Failed to send unban notification:', error)
    }
  }

  /**
   * Notify reporter that their report was resolved
   */
  static async notifyReportResolved(
    reporterId: string,
    outcome: 'action_taken' | 'no_action' | 'dismissed',
    reportId: string
  ): Promise<void> {
    if (!moderationConfig.notifications.notifyReporterOnResolution) {
      return
    }

    try {
      await Notification.create({
        userId: reporterId,
        actorId: reporterId,
        type: 'report_resolved',
        resourceType: 'report',
        resourceId: reportId,
        read: false,
      })

      const user = await User.find(reporterId)
      if (user?.pushToken) {
        let outcomeMessage = ''
        switch (outcome) {
          case 'action_taken':
            outcomeMessage = 'Action has been taken on the reported content.'
            break
          case 'no_action':
            outcomeMessage =
              'After review, no action was taken as the content does not violate our guidelines.'
            break
          case 'dismissed':
            outcomeMessage = 'Your report has been reviewed and closed.'
            break
        }

        await PushNotificationService.sendToUser(reporterId, {
          title: 'Report Update',
          body: `Your report has been reviewed. ${outcomeMessage}`,
          data: {
            type: 'report_resolved',
            reportId,
            outcome,
          },
        })
      }
    } catch (error) {
      console.error('Failed to send report resolution notification:', error)
    }
  }

  /**
   * Notify all admins about a high/critical priority report
   */
  static async notifyAdminsNewReport(
    reportId: string,
    priority: string,
    resourceType: string,
    reason: string
  ): Promise<void> {
    if (!moderationConfig.notifications.notifyAdminsOnHighPriority) {
      return
    }

    // Only notify for high and critical priority
    if (priority !== 'high' && priority !== 'critical') {
      return
    }

    try {
      // Get all admin users
      const admins = await User.query().where('role', 'admin')

      for (const admin of admins) {
        if (admin.pushToken) {
          await PushNotificationService.sendToUser(admin.id, {
            title: `${priority.toUpperCase()} Priority Report`,
            body: `New ${priority} priority report: ${reason} on ${resourceType}`,
            data: {
              type: 'admin_report_alert',
              reportId,
              priority,
              resourceType,
              reason,
            },
          })
        }
      }
    } catch (error) {
      console.error('Failed to notify admins of new report:', error)
    }
  }
}
