import Report from '#models/report'
import ModeratedContent from '#models/moderated_content'
import List from '#models/list'
import User from '#models/user'
import AppError from '#exceptions/app_error'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const reviewReportSchema = vine.compile(
  vine.object({
    status: vine.enum(['reviewed', 'resolved', 'rejected']),
    moderatorNotes: vine.string().maxLength(1000).optional(),
    action: vine.enum(['warning', 'delete', 'ban', 'none']).optional(),
  })
)

export default class ModerationsController {
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
   * @paramQuery page - Page number - @type(number)
   * @paramQuery limit - Items per page - @type(number)
   * @responseBody 200 - <Report[]>.paginated() - List of reports
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   */
  public async allReports({ request, response }: HttpContext) {
    const { status, page = 1, limit = 20 } = request.qs()

    const query = Report.query()
      .preload('reporter')
      .preload('moderator')
      .orderBy('created_at', 'desc')

    if (status) {
      query.where('status', status)
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

    if (data.action && data.action !== 'none') {
      await this.executeModerrationAction(report, data.action, admin.id, data.moderatorNotes || '')
    }

    return response.ok({
      message: 'Report reviewed successfully',
      data: report,
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

    const reportsAgainst = await Report.query()
      .where('resource_type', 'user')
      .where('resource_id', user.id)
      .count('* as total')

    const reportsSubmitted = await Report.query().where('reporter_id', user.id).count('* as total')

    const moderatedContent = await ModeratedContent.query()
      .where('user_id', user.id)
      .where('is_active', true)

    const recentModeratedContent = await ModeratedContent.query()
      .where('user_id', user.id)
      .orderBy('created_at', 'desc')
      .limit(5)

    const summary = {
      user: user.serialize({
        fields: {
          pick: ['id', 'username', 'displayName', 'email', 'role', 'createdAt'],
        },
      }),
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

  private async executeModerrationAction(
    report: Report,
    action: 'warning' | 'delete' | 'ban',
    moderatorId: string,
    notes: string
  ) {
    const { resourceType, resourceId } = report

    if (action === 'warning') {
      let originalContent = ''
      let moderationResourceType: any = 'username'
      let targetUserId: string | null = null

      if (resourceType === 'list') {
        const list = await List.find(resourceId)
        if (list) {
          originalContent = list.name
          moderationResourceType = 'list_name'
          targetUserId = list.userId
        }
      } else if (resourceType === 'user') {
        const user = await User.find(resourceId)
        if (user) {
          originalContent = user.username
          moderationResourceType = 'username'
          targetUserId = user.id
        }
      }

      if (targetUserId) {
        await ModeratedContent.create({
          userId: targetUserId,
          resourceType: moderationResourceType,
          resourceId,
          originalContent,
          censoredContent: null,
          action: 'warning',
          reason: 'reported',
          moderatedBy: moderatorId,
          moderatorNotes: notes,
          isActive: true,
        })
      }
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
          await list.delete()
        }
      }
    } else if (action === 'ban' && resourceType === 'user') {
      const user = await User.find(resourceId)
      if (user) {
        await ModeratedContent.create({
          userId: user.id,
          resourceType: 'username',
          resourceId: null,
          originalContent: user.username,
          censoredContent: null,
          action: 'user_banned',
          reason: 'reported',
          moderatedBy: moderatorId,
          moderatorNotes: notes,
          isActive: true,
        })

        user.role = 'user'
        await user.save()
      }
    }
  }
}
