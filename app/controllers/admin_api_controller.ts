import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Book from '#models/book'
import BookTracking from '#models/book_tracking'
import BookReview from '#models/book_review'
import List from '#models/list'
import ActivityLog from '#models/activity_log'
import { DateTime } from 'luxon'

export default class AdminApiController {
  /**
   * @summary List all users with key info
   * @tag Admin API
   * @description Returns paginated list of users with computed counts
   * @paramQuery page - Page number - @type(number)
   * @paramQuery limit - Items per page (default 50) - @type(number)
   * @paramQuery sort - Sort field (created_at, username) - @type(string)
   * @paramQuery order - Sort order (asc, desc) - @type(string)
   * @paramQuery search - Filter by username/email - @type(string)
   * @responseBody 200 - Paginated list of users
   * @responseBody 401 - Unauthorized
   */
  async listUsers({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = Math.min(request.input('limit', 50), 100)
    const sort = request.input('sort', 'created_at')
    const order = request.input('order', 'desc')
    const search = request.input('search')

    const validSortFields = ['created_at', 'username']
    const sortField = validSortFields.includes(sort) ? sort : 'created_at'
    const sortOrder = order === 'asc' ? 'asc' : 'desc'

    const query = User.query()

    if (search) {
      query.where((q) => {
        q.whereILike('username', `%${search}%`).orWhereILike('email', `%${search}%`)
      })
    }

    query.orderBy(sortField, sortOrder as 'asc' | 'desc')

    const users = await query.paginate(page, limit)

    // Get counts for each user
    const userIds = users.map((u) => u.id)

    const [bookCounts, reviewCounts, listCounts] = await Promise.all([
      db
        .from('book_tracking')
        .whereIn('user_id', userIds)
        .groupBy('user_id')
        .select('user_id', db.raw('count(*) as count')),
      db
        .from('book_reviews')
        .whereIn('user_id', userIds)
        .groupBy('user_id')
        .select('user_id', db.raw('count(*) as count')),
      db
        .from('lists')
        .whereIn('user_id', userIds)
        .groupBy('user_id')
        .select('user_id', db.raw('count(*) as count')),
    ])

    const bookCountMap = new Map(bookCounts.map((r) => [r.user_id, Number(r.count)]))
    const reviewCountMap = new Map(reviewCounts.map((r) => [r.user_id, Number(r.count)]))
    const listCountMap = new Map(listCounts.map((r) => [r.user_id, Number(r.count)]))

    const serialized = users.serialize()
    serialized.data = users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      plan: user.plan,
      createdAt: user.createdAt?.toISO(),
      isBanned: user.isBanned,
      emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
      bookCount: bookCountMap.get(user.id) || 0,
      reviewCount: reviewCountMap.get(user.id) || 0,
      listCount: listCountMap.get(user.id) || 0,
    }))

    return response.ok(serialized)
  }

  /**
   * @summary Get detailed user profile
   * @tag Admin API
   * @description Returns full user info with stats
   * @paramPath id - User ID - @type(string) @required
   * @responseBody 200 - User details with stats
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - User not found
   */
  async showUser({ params, response }: HttpContext) {
    const user = await User.find(params.id)

    if (!user) {
      return response.notFound({ error: 'User not found' })
    }

    // Get detailed stats
    const [
      bookCountsByStatus,
      reviewCount,
      listCount,
      followerCount,
      followingCount,
      lastActivity,
    ] = await Promise.all([
      // Book counts by status
      db
        .from('book_tracking')
        .where('user_id', user.id)
        .groupBy('status')
        .select('status', db.raw('count(*) as count')),

      // Review count
      BookReview.query().where('user_id', user.id).count('* as total'),

      // List count
      List.query().where('user_id', user.id).count('* as total'),

      // Follower count
      db.from('user_follows').where('following_id', user.id).count('* as total'),

      // Following count
      db.from('user_follows').where('follower_id', user.id).count('* as total'),

      // Last activity
      ActivityLog.query().where('user_id', user.id).orderBy('created_at', 'desc').first(),
    ])

    const statusCounts: Record<string, number> = {
      reading: 0,
      completed: 0,
      on_hold: 0,
      dropped: 0,
      plan_to_read: 0,
    }

    bookCountsByStatus.forEach((row) => {
      statusCounts[row.status] = Number(row.count)
    })

    return response.ok({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      role: user.role,
      plan: user.plan,
      createdAt: user.createdAt?.toISO(),
      emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
      isBanned: user.isBanned,
      bannedAt: user.bannedAt?.toISO() ?? null,
      bannedUntil: user.bannedUntil?.toISO() ?? null,
      banReason: user.banReason,
      strikeCount: user.strikeCount,
      stats: {
        bookCountsByStatus: statusCounts,
        totalBooks: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        reviewCount: Number(reviewCount[0].$extras.total),
        listCount: Number(listCount[0].$extras.total),
        followerCount: Number(followerCount[0].total),
        followingCount: Number(followingCount[0].total),
        lastActivityAt: lastActivity?.createdAt?.toISO() ?? null,
        registrationDate: user.createdAt?.toISO(),
      },
      subscription: {
        status: user.subscriptionStatus,
        expiresAt: user.subscriptionExpiresAt?.toISO() ?? null,
        period: user.subscriptionPeriod,
      },
    })
  }

  /**
   * @summary Get platform overview stats
   * @tag Admin API
   * @description Returns overall platform statistics
   * @responseBody 200 - Platform statistics
   * @responseBody 401 - Unauthorized
   */
  async stats({ response }: HttpContext) {
    const now = DateTime.now()
    const startOfDay = now.startOf('day')
    const startOfWeek = now.startOf('week')
    const startOfMonth = now.startOf('month')

    const [
      totalUsers,
      totalBooks,
      totalTrackings,
      totalReviews,
      totalLists,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      activeUsersToday,
      activeUsersThisWeek,
    ] = await Promise.all([
      User.query().count('* as total'),
      Book.query().count('* as total'),
      BookTracking.query().count('* as total'),
      BookReview.query().count('* as total'),
      List.query().count('* as total'),
      User.query().where('created_at', '>=', startOfDay.toSQL()!).count('* as total'),
      User.query().where('created_at', '>=', startOfWeek.toSQL()!).count('* as total'),
      User.query().where('created_at', '>=', startOfMonth.toSQL()!).count('* as total'),
      db
        .from('activity_logs')
        .where('created_at', '>=', startOfDay.toSQL()!)
        .countDistinct('user_id as total'),
      db
        .from('activity_logs')
        .where('created_at', '>=', startOfWeek.toSQL()!)
        .countDistinct('user_id as total'),
    ])

    return response.ok({
      totalUsers: Number(totalUsers[0].$extras.total),
      totalBooks: Number(totalBooks[0].$extras.total),
      totalTrackings: Number(totalTrackings[0].$extras.total),
      totalReviews: Number(totalReviews[0].$extras.total),
      totalLists: Number(totalLists[0].$extras.total),
      newUsersToday: Number(newUsersToday[0].$extras.total),
      newUsersThisWeek: Number(newUsersThisWeek[0].$extras.total),
      newUsersThisMonth: Number(newUsersThisMonth[0].$extras.total),
      activeUsersToday: Number(activeUsersToday[0].total),
      activeUsersThisWeek: Number(activeUsersThisWeek[0].total),
    })
  }

  /**
   * @summary Get growth statistics over time
   * @tag Admin API
   * @description Returns growth data for specified period
   * @paramQuery period - Grouping period (day/week/month) - @type(string)
   * @paramQuery from - Start date (ISO format) - @type(string)
   * @paramQuery to - End date (ISO format) - @type(string)
   * @responseBody 200 - Array of growth data points
   * @responseBody 401 - Unauthorized
   */
  async statsGrowth({ request, response }: HttpContext) {
    const period = request.input('period', 'day')
    const fromDate = request.input('from')
    const toDate = request.input('to')

    // Default to last 30 days if no dates specified
    const endDate = toDate ? DateTime.fromISO(toDate) : DateTime.now()
    const startDate = fromDate
      ? DateTime.fromISO(fromDate)
      : endDate.minus({ days: period === 'month' ? 365 : period === 'week' ? 90 : 30 })

    let dateFormat: string
    let truncate: string

    switch (period) {
      case 'week':
        dateFormat = 'YYYY-IW' // ISO week
        truncate = 'week'
        break
      case 'month':
        dateFormat = 'YYYY-MM'
        truncate = 'month'
        break
      default:
        dateFormat = 'YYYY-MM-DD'
        truncate = 'day'
    }

    const [newUsersData, activeUsersData] = await Promise.all([
      // New users per period
      db.rawQuery(
        `
        SELECT
          TO_CHAR(DATE_TRUNC(?, created_at), ?) as date,
          COUNT(*) as new_users
        FROM users
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY DATE_TRUNC(?, created_at)
        ORDER BY date ASC
      `,
        [truncate, dateFormat, startDate.toSQL(), endDate.toSQL(), truncate]
      ),

      // Active users per period (users with activity logs)
      db.rawQuery(
        `
        SELECT
          TO_CHAR(DATE_TRUNC(?, created_at), ?) as date,
          COUNT(DISTINCT user_id) as active_users
        FROM activity_logs
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY DATE_TRUNC(?, created_at)
        ORDER BY date ASC
      `,
        [truncate, dateFormat, startDate.toSQL(), endDate.toSQL(), truncate]
      ),
    ])

    // Merge data by date
    const dateMap = new Map<string, { date: string; newUsers: number; activeUsers: number }>()

    newUsersData.rows.forEach((row: any) => {
      dateMap.set(row.date, {
        date: row.date,
        newUsers: Number(row.new_users),
        activeUsers: 0,
      })
    })

    activeUsersData.rows.forEach((row: any) => {
      const existing = dateMap.get(row.date)
      if (existing) {
        existing.activeUsers = Number(row.active_users)
      } else {
        dateMap.set(row.date, {
          date: row.date,
          newUsers: 0,
          activeUsers: Number(row.active_users),
        })
      }
    })

    // Sort by date
    const result = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    return response.ok({ data: result })
  }

  /**
   * @summary Get retention metrics
   * @tag Admin API
   * @description Returns user retention statistics
   * @responseBody 200 - Retention metrics
   * @responseBody 401 - Unauthorized
   */
  async statsRetention({ response }: HttpContext) {
    const now = DateTime.now()
    const oneDayAgo = now.minus({ days: 1 })
    const oneWeekAgo = now.minus({ weeks: 1 })
    const oneMonthAgo = now.minus({ months: 1 })

    const [totalRegistered, activeLastDay, activeLastWeek, activeLastMonth] = await Promise.all([
      User.query().count('* as total'),
      db
        .from('activity_logs')
        .where('created_at', '>=', oneDayAgo.toSQL()!)
        .countDistinct('user_id as total'),
      db
        .from('activity_logs')
        .where('created_at', '>=', oneWeekAgo.toSQL()!)
        .countDistinct('user_id as total'),
      db
        .from('activity_logs')
        .where('created_at', '>=', oneMonthAgo.toSQL()!)
        .countDistinct('user_id as total'),
    ])

    const total = Number(totalRegistered[0].$extras.total)
    const dayActive = Number(activeLastDay[0].total)
    const weekActive = Number(activeLastWeek[0].total)
    const monthActive = Number(activeLastMonth[0].total)

    return response.ok({
      totalRegistered: total,
      activeLastDay: dayActive,
      activeLastWeek: weekActive,
      activeLastMonth: monthActive,
      retentionRateDay: total > 0 ? Math.round((dayActive / total) * 100 * 100) / 100 : 0,
      retentionRateWeek: total > 0 ? Math.round((weekActive / total) * 100 * 100) / 100 : 0,
      retentionRateMonth: total > 0 ? Math.round((monthActive / total) * 100 * 100) / 100 : 0,
    })
  }

  /**
   * @summary Get recent activity feed
   * @tag Admin API
   * @description Returns recent events across all users
   * @paramQuery limit - Number of items (default 20) - @type(number)
   * @paramQuery type - Filter by event type (registration/import/tracking/review) - @type(string)
   * @responseBody 200 - Array of recent activities
   * @responseBody 401 - Unauthorized
   */
  async activity({ request, response }: HttpContext) {
    const limit = Math.min(request.input('limit', 20), 100)
    const type = request.input('type')

    const query = ActivityLog.query().preload('user').orderBy('created_at', 'desc').limit(limit)

    if (type) {
      switch (type) {
        case 'registration':
          query.where('action', 'user.registered')
          break
        case 'import':
          query.where('action', 'like', 'import.%')
          break
        case 'tracking':
          query.where('action', 'like', 'book.%')
          break
        case 'review':
          query.where('action', 'like', 'review.%')
          break
      }
    }

    const activities = await query

    return response.ok({
      data: activities.map((activity) => ({
        id: activity.id,
        action: activity.action,
        resourceType: activity.resourceType,
        resourceId: activity.resourceId,
        metadata: activity.metadata,
        createdAt: activity.createdAt?.toISO(),
        user: activity.user
          ? {
              id: activity.user.id,
              username: activity.user.username,
              displayName: activity.user.displayName,
              avatar: activity.user.avatar,
            }
          : null,
      })),
    })
  }

  /**
   * @summary Get most popular manga/books
   * @tag Admin API
   * @description Returns most tracked books with stats
   * @paramQuery limit - Number of items (default 20) - @type(number)
   * @paramQuery period - Time period (all/week/month) - @type(string)
   * @responseBody 200 - Array of popular books
   * @responseBody 401 - Unauthorized
   */
  async topManga({ request, response }: HttpContext) {
    const limit = Math.min(request.input('limit', 20), 100)
    const period = request.input('period', 'all')

    let dateFilter = ''
    const params: any[] = []

    if (period === 'week') {
      dateFilter = 'AND bt.created_at >= ?'
      params.push(DateTime.now().minus({ weeks: 1 }).toSQL())
    } else if (period === 'month') {
      dateFilter = 'AND bt.created_at >= ?'
      params.push(DateTime.now().minus({ months: 1 }).toSQL())
    }

    params.push(limit)

    const result = await db.rawQuery(
      `
      SELECT
        b.id,
        b.title,
        b.cover_image,
        b.type,
        b.status,
        b.rating as global_rating,
        COUNT(bt.book_id) as tracking_count,
        AVG(bt.rating) FILTER (WHERE bt.rating IS NOT NULL) as average_rating,
        COUNT(br.id) as review_count
      FROM books b
      LEFT JOIN book_tracking bt ON b.id = bt.book_id ${dateFilter}
      LEFT JOIN book_reviews br ON b.id = br.book_id
      GROUP BY b.id
      ORDER BY tracking_count DESC
      LIMIT ?
    `,
      params
    )

    return response.ok({
      data: result.rows.map((row: any) => ({
        book: {
          id: row.id,
          title: row.title,
          coverImage: row.cover_image,
          type: row.type,
          status: row.status,
          globalRating: row.global_rating,
        },
        trackingCount: Number(row.tracking_count),
        averageRating: row.average_rating ? Number(row.average_rating).toFixed(2) : null,
        reviewCount: Number(row.review_count),
      })),
    })
  }
}
