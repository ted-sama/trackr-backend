import Report from '#models/report'
import List from '#models/list'
import User from '#models/user'
import BookReview from '#models/book_review'
import AppError from '#exceptions/app_error'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'

const createReportSchema = vine.compile(
  vine.object({
    resourceType: vine.enum(['user', 'list', 'review']),
    resourceId: vine.string(),
    reason: vine.enum(['offensive_content', 'spam', 'harassment', 'other']),
    description: vine.string().maxLength(1000).optional(),
  })
)

export default class ReportsController {
  /**
   * @summary Create a report
   * @tag Reports
   * @description Submit a report for offensive content, spam, or harassment
   * @requestBody { "resourceType": "list", "resourceId": "123", "reason": "offensive_content", "description": "Details..." }
   * @responseBody 201 - Report created successfully
   * @responseBody 400 - Bad request
   * @responseBody 401 - Unauthorized
   */
  public async create({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()

    const data = await request.validateUsing(createReportSchema)

    // Validate resource exists
    if (data.resourceType === 'list') {
      // List IDs are integers
      const listId = Number.parseInt(data.resourceId, 10)
      if (Number.isNaN(listId)) {
        throw new AppError('Invalid list ID', { status: 400, code: 'INVALID_INPUT' })
      }
      const list = await List.find(listId)
      if (!list) {
        throw new AppError('List not found', { status: 404, code: 'NOT_FOUND' })
      }
      // Check if user is trying to report their own list
      if (list.userId === user.id) {
        throw new AppError('Cannot report your own content', { status: 400, code: 'INVALID_INPUT' })
      }
    } else if (data.resourceType === 'user') {
      // User IDs are UUIDs
      const reportedUser = await User.find(data.resourceId)
      if (!reportedUser) {
        throw new AppError('User not found', { status: 404, code: 'NOT_FOUND' })
      }
      // Check if user is trying to report themselves
      if (data.resourceId === user.id) {
        throw new AppError('Cannot report yourself', { status: 400, code: 'INVALID_INPUT' })
      }
    } else if (data.resourceType === 'review') {
      // Review IDs are integers
      const reviewId = Number.parseInt(data.resourceId, 10)
      if (Number.isNaN(reviewId)) {
        throw new AppError('Invalid review ID', { status: 400, code: 'INVALID_INPUT' })
      }
      const review = await BookReview.find(reviewId)
      if (!review) {
        throw new AppError('Review not found', { status: 404, code: 'NOT_FOUND' })
      }
      // Check if user is trying to report their own review
      if (review.userId === user.id) {
        throw new AppError('Cannot report your own content', { status: 400, code: 'INVALID_INPUT' })
      }
    }

    const existingReport = await Report.query()
      .where('reporter_id', user.id)
      .where('resource_type', data.resourceType)
      .where('resource_id', data.resourceId)
      .where('status', 'pending')
      .first()

    if (existingReport) {
      throw new AppError('You have already reported this content', {
        status: 400,
        code: 'DUPLICATE_REPORT',
      })
    }

    const report = await Report.create({
      reporterId: user.id,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      reason: data.reason,
      description: data.description,
      status: 'pending',
    })

    return response.created({
      message: 'Report submitted successfully',
      data: report,
    })
  }

  /**
   * @summary Get my reports
   * @tag Reports
   * @description Get reports submitted by the authenticated user
   * @responseBody 200 - <Report[]> - List of reports
   * @responseBody 401 - Unauthorized
   */
  public async myReports({ auth, request, response }: HttpContext) {
    const { page = 1, limit = 10 } = request.qs()
    const user = await auth.authenticate()

    const reports = await Report.query()
      .where('reporter_id', user.id)
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    return response.ok({
      data: reports,
    })
  }

  /**
   * @summary Delete a report
   * @tag Reports
   * @description Cancel a pending report (only the reporter can do this)
   * @paramPath id - Report ID - @type(string) @required
   * @responseBody 200 - Report deleted successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 403 - Forbidden
   * @responseBody 404 - Report not found
   */
  public async delete({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()

    const report = await Report.findOrFail(params.id)

    if (report.reporterId !== user.id) {
      throw new AppError('You can only delete your own reports', { status: 403, code: 'FORBIDDEN' })
    }

    if (report.status !== 'pending') {
      throw new AppError('Cannot delete a report that has been reviewed', {
        status: 400,
        code: 'INVALID_STATUS',
      })
    }

    await report.delete()

    return response.ok({
      message: 'Report deleted successfully',
    })
  }
}
