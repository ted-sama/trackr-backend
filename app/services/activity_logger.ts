import ActivityLog from '#models/activity_log'

export interface ActivityLogData {
  userId: string
  action: string
  metadata: Record<string, any>
  resourceType: string
  resourceId: string | number
}

export class ActivityLogger {
  /**
   * Log une action utilisateur
   */
  static async log(data: ActivityLogData) {
    try {
      await ActivityLog.create({
        userId: data.userId,
        action: data.action,
        metadata: data.metadata,
        resourceType: data.resourceType,
        resourceId: data.resourceId?.toString(),
      })
    } catch (error) {
      console.error('Failed to log user activity:', error)
    }
  }

  /**
   * Récupère l'historique d'un utilisateur
   */
  static async getUserHistory(
    userId: string,
    options: {
      page?: number
      limit?: number
      action?: string
      resourceType?: string
    } = {}
  ) {
    const { page = 1, limit = 50, action, resourceType } = options

    const query = ActivityLog.query().where('user_id', userId)

    if (action) {
      query.where('action', action)
    }

    if (resourceType) {
      query.where('resource_type', resourceType)
    }

    return query.orderBy('created_at', 'desc').paginate(page, limit)
  }
}
