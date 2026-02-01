import Report from '#models/report'
import ModeratedContent from '#models/moderated_content'
import List from '#models/list'
import User from '#models/user'
import UserStrike from '#models/user_strike'
import BookReview from '#models/book_review'
import AppError from '#exceptions/app_error'
import BanService from '#services/ban_service'
import ModerationNotificationService from '#services/moderation_notification_service'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const reviewReportSchema = vine.compile(
  vine.object({
    status: vine.enum(['reviewed', 'resolved', 'rejected']),
    moderatorNotes: vine.string().maxLength(1000).optional(),
    action: vine.enum(['warning', 'delete', 'ban', 'temp_ban', 'none']).optional(),
    banDays: vine.number().min(1).max(365).optional(),
  })
)

const addStrikeSchema = vine.compile(
  vine.object({
    reason: vine.enum(['profanity', 'hate_speech', 'spam', 'harassment', 'other']),
    severity: vine.enum(['minor', 'moderate', 'severe']),
    notes: vine.string().maxLength(1000).optional(),
  })
)

const banUserSchema = vine.compile(
  vine.object({
    reason: vine.string().maxLength(500),
    durationDays: vine.number().min(1).max(365).optional(), // Optional = permanent ban
  })
)

export default class ModerationsController {
  /**
   * @summary Get moderation dashboard stats
   * @tag Moderation
   * @description Get overall moderation statistics (Admin only)
   * @responseBody 200 - Dashboard statistics
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   */
  public async dashboard({ response }: HttpContext) {
    const now = DateTime.now()
    const startOfDay = now.startOf('day')
    const startOfWeek = now.startOf('week')

    // Parallel queries for performance
    const [
      pendingReportsCount,
      todayReportsCount,
      weeklyBansCount,
      weeklyStrikesCount,
      reportsByStatus,
      reportsByPriority,
      recentReports,
      recentBans,
    ] = await Promise.all([
      // Pending reports
      Report.query().where('status', 'pending').count('* as total'),

      // Today's reports
      Report.query().where('created_at', '>=', startOfDay.toSQL()!).count('* as total'),

      // Weekly bans
      User.query()
        .whereNotNull('banned_at')
        .where('banned_at', '>=', startOfWeek.toSQL()!)
        .count('* as total'),

      // Weekly strikes
      UserStrike.query().where('created_at', '>=', startOfWeek.toSQL()!).count('* as total'),

      // Reports by status
      Report.query().select('status').count('* as count').groupBy('status'),

      // Reports by priority
      Report.query()
        .where('status', 'pending')
        .select('priority')
        .count('* as count')
        .groupBy('priority'),

      // Recent pending reports (top 5)
      Report.query()
        .where('status', 'pending')
        .preload('reporter')
        .orderBy('priority', 'desc')
        .orderBy('created_at', 'asc')
        .limit(5),

      // Recent bans (top 5)
      User.query().where('is_banned', true).orderBy('banned_at', 'desc').limit(5),
    ])

    return response.ok({
      overview: {
        pendingReports: Number(pendingReportsCount[0].$extras.total),
        todayReports: Number(todayReportsCount[0].$extras.total),
        weeklyBans: Number(weeklyBansCount[0].$extras.total),
        weeklyStrikes: Number(weeklyStrikesCount[0].$extras.total),
      },
      reportsByStatus: reportsByStatus.reduce(
        (acc, row) => {
          acc[row.status] = Number(row.$extras.count)
          return acc
        },
        {} as Record<string, number>
      ),
      pendingByPriority: reportsByPriority.reduce(
        (acc, row) => {
          acc[row.$extras.priority || 'medium'] = Number(row.$extras.count)
          return acc
        },
        {} as Record<string, number>
      ),
      recentPendingReports: recentReports.map((r) =>
        r.serialize({
          relations: {
            reporter: {
              fields: { pick: ['id', 'username', 'displayName', 'avatar'] },
            },
          },
        })
      ),
      recentBans: recentBans.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        bannedAt: u.bannedAt?.toISO(),
        bannedUntil: u.bannedUntil?.toISO(),
        banReason: u.banReason,
        isPermanent: !u.bannedUntil,
      })),
    })
  }

  /**
   * @summary Get report statistics
   * @tag Moderation
   * @description Get detailed report statistics (Admin only)
   * @responseBody 200 - Report statistics
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   */
  public async reportStats({ response }: HttpContext) {
    const [byStatus, byReason, byResourceType, byMonth] = await Promise.all([
      // By status
      Report.query().select('status').count('* as count').groupBy('status'),

      // By reason
      Report.query().select('reason').count('* as count').groupBy('reason'),

      // By resource type
      Report.query().select('resource_type').count('* as count').groupBy('resource_type'),

      // Last 6 months trend
      Report.query()
        .select(this.raw("to_char(created_at, 'YYYY-MM') as month"))
        .count('* as count')
        .where('created_at', '>=', DateTime.now().minus({ months: 6 }).toSQL()!)
        .groupByRaw("to_char(created_at, 'YYYY-MM')")
        .orderByRaw("to_char(created_at, 'YYYY-MM')"),
    ])

    return response.ok({
      byStatus: byStatus.reduce(
        (acc, row) => {
          acc[row.status] = Number(row.$extras.count)
          return acc
        },
        {} as Record<string, number>
      ),
      byReason: byReason.reduce(
        (acc, row) => {
          acc[row.reason] = Number(row.$extras.count)
          return acc
        },
        {} as Record<string, number>
      ),
      byResourceType: byResourceType.reduce(
        (acc, row) => {
          acc[row.$extras.resource_type] = Number(row.$extras.count)
          return acc
        },
        {} as Record<string, number>
      ),
      monthlyTrend: byMonth.map((row) => ({
        month: row.$extras.month,
        count: Number(row.$extras.count),
      })),
    })
  }

  private raw(query: string) {
    return { sql: query }
  }

  /**
   * @summary Get all pending reports
   * @tag Moderation
   * @description Get all reports pending review (Admin only)
   * @responseBody 200 - <Report[]> - List of pending reports
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   */
  public async pendingReports({ response }: HttpContext) {
    const reports = await Report.query()
      .where('status', 'pending')
      .preload('reporter')
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'asc')

    return response.ok({
      data: reports.map((report) =>
        report.serialize({
          relations: {
            reporter: {
              fields: {
                pick: ['id', 'username', 'displayName', 'avatar'],
              },
            },
          },
        })
      ),
    })
  }

  /**
   * @summary Get all reports
   * @tag Moderation
   * @description Get all reports with filtering (Admin only)
   * @paramQuery status - Filter by status - @type(string)
   * @paramQuery priority - Filter by priority - @type(string)
   * @paramQuery page - Page number - @type(number)
   * @paramQuery limit - Items per page - @type(number)
   * @responseBody 200 - <Report[]>.paginated() - List of reports
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   */
  public async allReports({ request, response }: HttpContext) {
    const { status, priority, page = 1, limit = 20 } = request.qs()

    const query = Report.query()
      .preload('reporter')
      .preload('moderator')
      .orderBy('priority', 'desc')
      .orderBy('created_at', 'desc')

    if (status) {
      query.where('status', status)
    }

    if (priority) {
      query.where('priority', priority)
    }

    const reports = await query.paginate(page, limit)

    const serialized = reports.serialize({
      relations: {
        reporter: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar'],
          },
        },
        moderator: {
          fields: {
            pick: ['id', 'username', 'displayName'],
          },
        },
      },
    })

    return response.ok(serialized)
  }

  /**
   * @summary Review a report
   * @tag Moderation
   * @description Review and take action on a report (Admin only)
   * @paramPath id - Report ID - @type(string) @required
   * @requestBody { "status": "resolved", "moderatorNotes": "...", "action": "warning" }
   * @responseBody 200 - Report reviewed successfully
   * @responseBody 400 - Bad request
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - Report not found
   */
  public async reviewReport({ auth, params, request, response }: HttpContext) {
    const admin = auth.user!
    const data = await request.validateUsing(reviewReportSchema)

    const report = await Report.query().where('id', params.id).firstOrFail()

    if (report.status !== 'pending') {
      throw new AppError('This report has already been reviewed', {
        status: 400,
        code: 'ALREADY_REVIEWED',
      })
    }

    report.status = data.status
    report.moderatorNotes = data.moderatorNotes ?? null
    report.reviewedBy = admin.id
    report.reviewedAt = DateTime.now()
    await report.save()

    let actionResult = null
    if (data.action && data.action !== 'none') {
      actionResult = await this.executeModerrationAction(
        report,
        data.action,
        admin.id,
        data.moderatorNotes || '',
        data.banDays
      )
    }

    // Notify reporter of resolution
    const outcome =
      data.action && data.action !== 'none'
        ? 'action_taken'
        : data.status === 'rejected'
          ? 'dismissed'
          : 'no_action'
    await ModerationNotificationService.notifyReportResolved(report.reporterId, outcome, report.id)

    return response.ok({
      message: 'Report reviewed successfully',
      data: report,
      actionResult,
    })
  }

  /**
   * @summary Get moderated content history
   * @tag Moderation
   * @description Get history of moderated content (Admin only)
   * @paramQuery userId - Filter by user ID - @type(string)
   * @paramQuery page - Page number - @type(number)
   * @paramQuery limit - Items per page - @type(number)
   * @responseBody 200 - <ModeratedContent[]>.paginated() - List of moderated content
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   */
  public async moderatedContent({ request, response }: HttpContext) {
    const { userId, page = 1, limit = 20 } = request.qs()

    const query = ModeratedContent.query()
      .preload('user')
      .preload('moderator')
      .orderBy('created_at', 'desc')

    if (userId) {
      query.where('user_id', userId)
    }

    const content = await query.paginate(page, limit)

    const serialized = content.serialize({
      relations: {
        user: {
          fields: {
            pick: ['id', 'username', 'displayName', 'email'],
          },
        },
        moderator: {
          fields: {
            pick: ['id', 'username', 'displayName'],
          },
        },
      },
    })

    return response.ok(serialized)
  }

  /**
   * @summary Get user moderation summary
   * @tag Moderation
   * @description Get moderation summary for a specific user (Admin only)
   * @paramPath userId - User ID - @type(string) @required
   * @responseBody 200 - User moderation summary
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - User not found
   */
  public async userModerationSummary({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.userId)

    const [reportsAgainst, reportsSubmitted, moderatedContent, recentModeratedContent, banStatus] =
      await Promise.all([
        Report.query()
          .where('resource_type', 'user')
          .where('resource_id', user.id)
          .count('* as total'),

        Report.query().where('reporter_id', user.id).count('* as total'),

        ModeratedContent.query().where('user_id', user.id).where('is_active', true),

        ModeratedContent.query().where('user_id', user.id).orderBy('created_at', 'desc').limit(5),

        BanService.checkBanStatus(user.id),
      ])

    const summary = {
      user: {
        ...user.serialize({
          fields: {
            pick: ['id', 'username', 'displayName', 'email', 'role', 'createdAt'],
          },
        }),
        strikeCount: user.strikeCount,
        lastStrikeAt: user.lastStrikeAt?.toISO(),
      },
      banStatus,
      statistics: {
        reportsAgainst: Number(reportsAgainst[0].$extras.total),
        reportsSubmitted: Number(reportsSubmitted[0].$extras.total),
        totalModeratedContent: moderatedContent.length,
        warnings: moderatedContent.filter((c) => c.action === 'warning').length,
        deletions: moderatedContent.filter((c) => c.action === 'deleted').length,
        bans: moderatedContent.filter((c) => c.action === 'user_banned').length,
      },
      recentModeratedContent: recentModeratedContent.map((c) =>
        c.serialize({
          fields: {
            omit: ['userId', 'moderatedBy'],
          },
        })
      ),
    }

    return response.ok(summary)
  }

  /**
   * @summary Get user's strike history
   * @tag Moderation
   * @description Get all strikes for a user (Admin only)
   * @paramPath userId - User ID - @type(string) @required
   * @responseBody 200 - User's strikes
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - User not found
   */
  public async userStrikes({ params, response }: HttpContext) {
    await User.findOrFail(params.userId)

    const strikes = await BanService.getAllStrikes(params.userId)

    return response.ok({
      data: strikes.map((strike) => ({
        ...strike.serialize(),
        isActive: strike.isActive,
        issuer: strike.issuer
          ? {
              id: strike.issuer.id,
              username: strike.issuer.username,
              displayName: strike.issuer.displayName,
            }
          : null,
      })),
    })
  }

  /**
   * @summary Add strike to user
   * @tag Moderation
   * @description Manually add a strike to a user (Admin only)
   * @paramPath userId - User ID - @type(string) @required
   * @requestBody { "reason": "harassment", "severity": "moderate", "notes": "..." }
   * @responseBody 200 - Strike added
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - User not found
   */
  public async addStrike({ auth, params, request, response }: HttpContext) {
    const admin = auth.user!
    const data = await request.validateUsing(addStrikeSchema)

    await User.findOrFail(params.userId)

    const result = await BanService.addStrike(params.userId, data.reason, data.severity, {
      issuedBy: admin.id,
      notes: data.notes,
    })

    // Send notification based on result
    if (result.action === 'warning') {
      await ModerationNotificationService.notifyStrikeReceived(
        params.userId,
        result.strikeCount,
        data.reason
      )
    } else if (result.action === 'temp_ban' && result.banUntil) {
      const durationDays = Math.ceil(result.banUntil.diff(DateTime.now(), 'days').days)
      await ModerationNotificationService.notifyAccountBanned(
        params.userId,
        durationDays,
        data.reason
      )
    } else if (result.action === 'perm_ban') {
      await ModerationNotificationService.notifyAccountBanned(params.userId, null, data.reason)
    }

    return response.ok({
      message: result.message,
      action: result.action,
      strikeCount: result.strikeCount,
      banUntil: result.banUntil?.toISO(),
    })
  }

  /**
   * @summary Ban a user
   * @tag Moderation
   * @description Ban a user temporarily or permanently (Admin only)
   * @paramPath userId - User ID - @type(string) @required
   * @requestBody { "reason": "Repeated violations", "durationDays": 7 }
   * @responseBody 200 - User banned
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - User not found
   */
  public async banUser({ auth, params, request, response }: HttpContext) {
    const admin = auth.user!
    const data = await request.validateUsing(banUserSchema)

    const user = await User.findOrFail(params.userId)

    // Prevent banning admins
    if (user.role === 'admin') {
      throw new AppError('Cannot ban an admin user', {
        status: 400,
        code: 'CANNOT_BAN_ADMIN',
      })
    }

    let bannedUntil: DateTime | null = null

    if (data.durationDays) {
      // Temporary ban
      bannedUntil = await BanService.tempBan(
        params.userId,
        data.durationDays,
        data.reason,
        admin.id
      )
      await ModerationNotificationService.notifyAccountBanned(
        params.userId,
        data.durationDays,
        data.reason
      )
    } else {
      // Permanent ban
      await BanService.permaBan(params.userId, data.reason, admin.id)
      await ModerationNotificationService.notifyAccountBanned(params.userId, null, data.reason)
    }

    // Log moderation action
    await ModeratedContent.create({
      userId: user.id,
      resourceType: 'username',
      resourceId: null,
      originalContent: user.username,
      censoredContent: null,
      action: 'user_banned',
      reason: 'reported',
      moderatedBy: admin.id,
      moderatorNotes: data.reason,
      isActive: true,
    })

    return response.ok({
      message: data.durationDays
        ? `User banned for ${data.durationDays} days`
        : 'User permanently banned',
      bannedUntil: bannedUntil?.toISO() || null,
      isPermanent: !data.durationDays,
    })
  }

  /**
   * @summary Unban a user
   * @tag Moderation
   * @description Remove ban from a user (Admin only)
   * @paramPath userId - User ID - @type(string) @required
   * @responseBody 200 - User unbanned
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - User not found
   */
  public async unbanUser({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.userId)

    if (!user.isBanned) {
      throw new AppError('User is not banned', {
        status: 400,
        code: 'NOT_BANNED',
      })
    }

    await BanService.unban(params.userId)
    await ModerationNotificationService.notifyAccountUnbanned(params.userId)

    return response.ok({
      message: 'User unbanned successfully',
    })
  }

  /**
   * @summary Remove a strike
   * @tag Moderation
   * @description Remove a specific strike from a user (Admin only)
   * @paramPath userId - User ID - @type(string) @required
   * @paramPath strikeId - Strike ID - @type(string) @required
   * @responseBody 200 - Strike removed
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - Strike not found
   */
  public async removeStrike({ params, response }: HttpContext) {
    await BanService.removeStrike(params.strikeId, params.userId)

    return response.ok({
      message: 'Strike removed successfully',
    })
  }

  /**
   * @summary Clear all strikes
   * @tag Moderation
   * @description Clear all strikes for a user (Admin only)
   * @paramPath userId - User ID - @type(string) @required
   * @responseBody 200 - All strikes cleared
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - User not found
   */
  public async clearStrikes({ params, response }: HttpContext) {
    await User.findOrFail(params.userId)
    await BanService.clearAllStrikes(params.userId)

    return response.ok({
      message: 'All strikes cleared successfully',
    })
  }

  private async executeModerrationAction(
    report: Report,
    action: 'warning' | 'delete' | 'ban' | 'temp_ban',
    moderatorId: string,
    notes: string,
    banDays?: number
  ) {
    const { resourceType, resourceId } = report

    // Get target user ID based on resource type
    let targetUserId: string | null = null

    if (resourceType === 'user') {
      targetUserId = resourceId
    } else if (resourceType === 'list') {
      const list = await List.find(resourceId)
      targetUserId = list?.userId ?? null
    } else if (resourceType === 'review') {
      const review = await BookReview.find(Number(resourceId))
      targetUserId = review?.userId ?? null
    }

    if (!targetUserId) {
      return { error: 'Could not determine target user' }
    }

    if (action === 'warning') {
      // Add strike for warning
      const result = await BanService.addStrike(targetUserId, 'other', 'minor', {
        issuedBy: moderatorId,
        reportId: report.id,
        notes,
      })

      await ModerationNotificationService.notifyStrikeReceived(
        targetUserId,
        result.strikeCount,
        'community guidelines violation'
      )

      return result
    } else if (action === 'delete') {
      if (resourceType === 'list') {
        const list = await List.find(resourceId)
        if (list && list.userId) {
          await ModeratedContent.create({
            userId: list.userId,
            resourceType: 'list_name',
            resourceId: list.id.toString(),
            originalContent: list.name,
            censoredContent: null,
            action: 'deleted',
            reason: 'reported',
            moderatedBy: moderatorId,
            moderatorNotes: notes,
            isActive: true,
          })

          await ModerationNotificationService.notifyContentModerated(
            list.userId,
            'list',
            'deleted',
            'community guidelines violation'
          )

          await list.delete()
          return { deleted: 'list', listId: resourceId }
        }
      } else if (resourceType === 'review') {
        const review = await BookReview.find(Number(resourceId))
        if (review && review.userId) {
          await ModeratedContent.create({
            userId: review.userId,
            resourceType: 'review_content',
            resourceId: review.id.toString(),
            originalContent: review.content || '',
            censoredContent: null,
            action: 'deleted',
            reason: 'reported',
            moderatedBy: moderatorId,
            moderatorNotes: notes,
            isActive: true,
          })

          await ModerationNotificationService.notifyContentModerated(
            review.userId,
            'review',
            'deleted',
            'community guidelines violation'
          )

          await review.delete()
          return { deleted: 'review', reviewId: resourceId }
        }
      }
    } else if (action === 'temp_ban') {
      const days = banDays || 7 // Default 7 days if not specified
      const bannedUntil = await BanService.tempBan(targetUserId, days, notes, moderatorId)

      await ModeratedContent.create({
        userId: targetUserId,
        resourceType: 'username',
        resourceId: null,
        originalContent: (await User.find(targetUserId))?.username || '',
        censoredContent: null,
        action: 'user_banned',
        reason: 'reported',
        moderatedBy: moderatorId,
        moderatorNotes: `Temp ban ${days} days: ${notes}`,
        isActive: true,
      })

      await ModerationNotificationService.notifyAccountBanned(
        targetUserId,
        days,
        'community guidelines violation'
      )

      return { tempBan: true, days, bannedUntil: bannedUntil.toISO() }
    } else if (action === 'ban') {
      await BanService.permaBan(targetUserId, notes, moderatorId)

      await ModeratedContent.create({
        userId: targetUserId,
        resourceType: 'username',
        resourceId: null,
        originalContent: (await User.find(targetUserId))?.username || '',
        censoredContent: null,
        action: 'user_banned',
        reason: 'reported',
        moderatedBy: moderatorId,
        moderatorNotes: `Permanent: ${notes}`,
        isActive: true,
      })

      await ModerationNotificationService.notifyAccountBanned(
        targetUserId,
        null,
        'community guidelines violation'
      )

      return { permaBan: true }
    }

    return null
  }
}
