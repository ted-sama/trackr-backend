import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import BookTracking from '#models/book_tracking'
import User from '#models/user'
// import ActivityLog from '#models/activity_log'
// import Book from '#models/book'

export default class StatsController {
  /**
   * @summary Get user statistics
   * @description Returns various statistics about the user's reading habits
   */
  async index({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    // 1. Overview Stats
    const overview = await this.getOverviewStats(user.id)

    // 2. Distributions
    const distributions = await this.getDistributions(user.id)

    // 3. Activity History
    const activity = await this.getActivityStats(user.id)

    // 4. Preferences
    const preferences = await this.getPreferences(user.id)

    // 5. Series Stats
    const series = await this.getSeriesStats(user.id)

    // 6. Authors
    const authors = await this.getTopAuthors(user.id)

    // 7. Completion Funnel
    const funnel = await this.getCompletionFunnel(user.id)

    return response.ok({
      overview,
      distributions,
      activity,
      preferences,
      series,
      authors,
      funnel,
    })
  }

  /**
   * @summary Get any user's statistics by username
   * @description Returns various statistics about a specific user's reading habits
   */
  async showUserStats({ params, response }: HttpContext) {
    const user = await User.findBy('username', params.username)
    if (!user) {
      return response.notFound({ message: 'User not found' })
    }

    // 1. Overview Stats
    const overview = await this.getOverviewStats(user.id)

    // 2. Distributions
    const distributions = await this.getDistributions(user.id)

    // 3. Activity History
    const activity = await this.getActivityStats(user.id)

    // 4. Preferences
    const preferences = await this.getPreferences(user.id)

    // 5. Series Stats
    const series = await this.getSeriesStats(user.id)

    // 6. Authors
    const authors = await this.getTopAuthors(user.id)

    // 7. Completion Funnel
    const funnel = await this.getCompletionFunnel(user.id)

    return response.ok({
      overview,
      distributions,
      activity,
      preferences,
      series,
      authors,
      funnel,
    })
  }

  private async getOverviewStats(userId: string) {
    const stats = await db
      .from('book_tracking')
      .where('user_id', userId)
      .select(
        db.raw('count(*) as total_followed'),
        db.raw('sum(coalesce(current_chapter, 0)) as total_chapters_read'),
        db.raw("count(*) filter (where status = 'completed') as completed_count"),
        db.raw("count(*) filter (where status = 'reading') as reading_count"),
        db.raw('avg(rating) filter (where rating is not null) as avg_rating')
      )
      .first()

    // Calculate longest reading streak (consecutive weeks with reading activity)
    const longestStreak = await this.calculateLongestStreak(userId)

    return {
      totalFollowed: Number(stats.total_followed),
      totalChaptersRead: Number(stats.total_chapters_read),
      longestStreak,
      completedCount: Number(stats.completed_count),
      readingCount: Number(stats.reading_count),
      avgRating: Number(stats.avg_rating || 0).toFixed(1),
    }
  }

  private async calculateLongestStreak(userId: string): Promise<number> {
    // Get all weeks with reading activity (chapter or volume updates)
    const weeksWithActivity = await db.rawQuery(
      `
      SELECT DISTINCT
        DATE_TRUNC('week', created_at) as week_start
      FROM activity_logs
      WHERE user_id = ?
      AND (action = 'book.currentChapterUpdated' OR action = 'book.currentVolumeUpdated')
      ORDER BY week_start ASC
    `,
      [userId]
    )

    if (weeksWithActivity.rows.length === 0) {
      return 0
    }

    let longestStreak = 1
    let currentStreak = 1

    // Calculate consecutive weeks
    for (let i = 1; i < weeksWithActivity.rows.length; i++) {
      const prevWeek = new Date(weeksWithActivity.rows[i - 1].week_start)
      const currentWeek = new Date(weeksWithActivity.rows[i].week_start)

      // Check if weeks are consecutive (7 days apart)
      const diffInDays = Math.floor(
        (currentWeek.getTime() - prevWeek.getTime()) / (1000 * 60 * 60 * 24)
      )

      if (diffInDays === 7) {
        currentStreak++
        longestStreak = Math.max(longestStreak, currentStreak)
      } else {
        currentStreak = 1
      }
    }

    return longestStreak
  }

  private async getDistributions(userId: string) {
    // Genres (from books.genres)
    const genresResult = await db.rawQuery(
      `
      SELECT 
        g.genre as x, 
        COUNT(*) as y
      FROM books b
      JOIN book_tracking bt ON b.id = bt.book_id
      CROSS JOIN json_array_elements_text(b.genres) AS g(genre)
      WHERE bt.user_id = ?
      GROUP BY g.genre
      ORDER BY y DESC
      `,
      [userId]
    )

    const genres = genresResult.rows.map((row: any) => ({
      x: row.x,
      y: Number(row.y),
    }))

    // Types (Manga, Manhwa, etc)
    const types = await db
      .from('books')
      .join('book_tracking', 'books.id', 'book_tracking.book_id')
      .where('book_tracking.user_id', userId)
      .groupBy('books.type')
      .select('books.type as x', db.raw('count(book_tracking.book_id) as y'))
      .orderBy('y', 'desc')

    // Ratings
    const ratings = await db
      .from('book_tracking')
      .where('user_id', userId)
      .whereNotNull('rating')
      .groupBy('rating')
      .select('rating as x', db.raw('count(*) as y'))
      .orderBy('rating', 'desc')

    return { genres, types, ratings }
  }

  private async getActivityStats(userId: string) {
    // Chapters read per month (last 12 months)
    // Using activity logs for "book.currentChapterUpdated"
    // Note: This relies on logs existing. If logs are purged, this data is lost.

    const monthly = await db.rawQuery(
      `
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as x,
        COUNT(*) as y
      FROM activity_logs
      WHERE user_id = ?
      AND action = 'book.currentChapterUpdated'
      AND created_at > NOW() - INTERVAL '1 year'
      GROUP BY x
      ORDER BY x ASC
    `,
      [userId]
    )

    return {
      chaptersReadHistory: monthly.rows,
    }
  }

  private async getPreferences(userId: string) {
    // Preferred reading days/hours based on activity
    // Heatmap data: day (0-6), hour (0-23), count

    const heatmap = await db.rawQuery(
      `
      SELECT 
        EXTRACT(DOW FROM created_at) as day,
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as count
      FROM activity_logs
      WHERE user_id = ?
      AND action LIKE 'book.%'
      GROUP BY day, hour
      ORDER BY day, hour
    `,
      [userId]
    )

    return {
      heatmap: heatmap.rows.map((row: any) => ({
        day: Number(row.day),
        hour: Number(row.hour),
        value: Number(row.count),
      })),
    }
  }

  private async getSeriesStats(userId: string) {
    // Long vs Short series (Completed only)
    // One-shots: exactly 1 chapter OR exactly 1 volume, Short: 2-49 chapters, Medium: 50-500, Long: > 500

    const lengths = await db
      .from('book_tracking')
      .join('books', 'book_tracking.book_id', 'books.id')
      .where('book_tracking.user_id', userId)
      .where('book_tracking.status', 'completed')
      .select('books.chapters', 'books.volumes')

    let oneshot = 0
    let short = 0
    let medium = 0
    let long = 0

    lengths.forEach((row) => {
      const ch = row.chapters ?? 0
      const vol = row.volumes ?? 0
      // One-shot: chapters==1 OR volumes==1 (must not be null, allow 0 as "unknown"?)
      if (ch === 1 || vol === 1) oneshot++
      else if (ch > 1 && ch < 50) short++
      else if (ch > 500) long++
      else if (ch >= 50 && ch <= 500) medium++
    })

    // Progress on current series (Reading)
    // Limit to top 20 active by update time
    const progress = await BookTracking.query()
      .where('user_id', userId)
      .where('status', 'reading')
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors').preload('publishers')
      })
      .orderBy('updated_at', 'desc')
      .limit(20)

    const progressData = progress.map((bt) => ({
      title: bt.book.title,
      read: bt.currentChapter || 0,
      total: bt.book.chapters || 0,
      percentage:
        bt.book.chapters && bt.book.chapters > 0
          ? Math.round(((bt.currentChapter || 0) / bt.book.chapters) * 100)
          : 0,
    }))

    return {
      distribution: [
        { x: 'oneshot', y: oneshot },
        { x: 'short', y: short },
        { x: 'medium', y: medium },
        { x: 'long', y: long },
      ],
      currentProgress: progressData,
    }
  }

  private async getTopAuthors(userId: string) {
    const authors = await db
      .from('authors')
      .join('author_books', 'authors.id', 'author_books.author_id')
      .join('book_tracking', 'author_books.book_id', 'book_tracking.book_id')
      .where('book_tracking.user_id', userId)
      .groupBy('authors.name')
      .select('authors.name as x', db.raw('count(book_tracking.book_id) as y'))
      .orderBy('y', 'desc')
      .limit(5)

    return authors
  }

  private async getCompletionFunnel(userId: string) {
    // Snapshot based funnel
    // 1. Plan to Read -> Reading conversion
    // Defined as: Reading+Completed / (Plan + Reading + Completed + OnHold + Dropped)
    // Actually let's just return the counts by status to let frontend build the funnel or ratios

    const statusCounts = await db
      .from('book_tracking')
      .where('user_id', userId)
      .groupBy('status')
      .select('status', db.raw('count(*) as count'))

    // Initialize all possible statuses with 0
    const counts: Record<string, number> = {
      plan_to_read: 0,
      reading: 0,
      completed: 0,
      on_hold: 0,
      dropped: 0,
    }

    // Update with actual counts from database
    statusCounts.forEach((row) => {
      counts[row.status] = Number(row.count)
    })

    const planToRead = counts['plan_to_read']
    const reading = counts['reading']
    const completed = counts['completed']
    const onHold = counts['on_hold']
    const dropped = counts['dropped']

    const totalLibrary = planToRead + reading + completed + onHold + dropped
    const started = reading + completed + onHold + dropped // Books that left 'plan' (assuming they started there)

    const planToReadingRatio = totalLibrary > 0 ? (started / totalLibrary) * 100 : 0

    // Reading -> Completed
    // Of those started, how many completed?
    const readingToCompletedRatio = started > 0 ? (completed / started) * 100 : 0

    return {
      planToReadingRatio: Math.round(planToReadingRatio),
      readingToCompletedRatio: Math.round(readingToCompletedRatio),
      counts,
    }
  }
}
