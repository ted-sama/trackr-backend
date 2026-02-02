import { DateTime } from 'luxon'
import RefreshToken from '#models/refresh_token'
import PasswordResetToken from '#models/password_reset_token'
import BookRecap from '#models/book_recap'
import UserStrike from '#models/user_strike'
import Notification from '#models/notification'
import ActivityLog from '#models/activity_log'
import Report from '#models/report'
import ModeratedContent from '#models/moderated_content'
import User from '#models/user'
import Book from '#models/book'
import Author from '#models/author'
import Publisher from '#models/publisher'
import Category from '#models/category'
import List from '#models/list'
import ImageStorageService from '#services/image_storage_service'

export interface CleanupResult {
  task: string
  deletedCount: number
  updatedCount?: number
  error?: string
}

export interface MaintenanceReport {
  startedAt: DateTime
  completedAt: DateTime
  results: CleanupResult[]
  totalDeleted: number
  totalUpdated: number
  errors: string[]
}

/**
 * Centralized service for database maintenance operations.
 * All cleanup and maintenance logic is consolidated here for consistency.
 */
export default class DatabaseMaintenanceService {
  /**
   * Clean up expired and revoked refresh tokens.
   * Deletes tokens that are expired or revoked more than 7 days ago.
   */
  static async cleanupRefreshTokens(): Promise<CleanupResult> {
    try {
      const deletedCount = await RefreshToken.cleanupExpiredAndRevoked()
      return { task: 'refresh_tokens', deletedCount }
    } catch (error) {
      return {
        task: 'refresh_tokens',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up expired password reset tokens.
   */
  static async cleanupPasswordResetTokens(): Promise<CleanupResult> {
    try {
      const deleted = await PasswordResetToken.query()
        .where('expires_at', '<', DateTime.now().toSQL()!)
        .delete()

      return { task: 'password_reset_tokens', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'password_reset_tokens',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up expired book recaps.
   */
  static async cleanupBookRecaps(): Promise<CleanupResult> {
    try {
      const deleted = await BookRecap.query()
        .whereNotNull('expires_at')
        .where('expires_at', '<', DateTime.now().toSQL()!)
        .delete()

      return { task: 'book_recaps', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'book_recaps',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up expired user strikes.
   * Deletes strikes that have passed their expiration date.
   */
  static async cleanupExpiredStrikes(): Promise<CleanupResult> {
    try {
      // Get users who will have strikes removed to update their strike count
      const expiredStrikes = await UserStrike.query()
        .whereNotNull('expires_at')
        .where('expires_at', '<', DateTime.now().toSQL()!)
        .select('user_id')

      const userIds = [...new Set(expiredStrikes.map((s) => s.userId))]

      // Delete the expired strikes
      const deleted = await UserStrike.query()
        .whereNotNull('expires_at')
        .where('expires_at', '<', DateTime.now().toSQL()!)
        .delete()

      // Update strike counts for affected users
      for (const userId of userIds) {
        const activeStrikeCount = await UserStrike.query()
          .where('user_id', userId)
          .where((q) => {
            q.whereNull('expires_at').orWhere('expires_at', '>', DateTime.now().toSQL()!)
          })
          .count('* as total')

        await User.query()
          .where('id', userId)
          .update({ strikeCount: Number(activeStrikeCount[0].$extras.total) || 0 })
      }

      return {
        task: 'user_strikes',
        deletedCount: deleted.length,
        updatedCount: userIds.length,
      }
    } catch (error) {
      return {
        task: 'user_strikes',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up old notifications.
   * @param retentionDays Number of days to retain notifications (default: 90)
   */
  static async cleanupNotifications(retentionDays: number = 90): Promise<CleanupResult> {
    try {
      const cutoffDate = DateTime.now().minus({ days: retentionDays }).toSQL()!

      const deleted = await Notification.query().where('created_at', '<', cutoffDate).delete()

      return { task: 'notifications', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'notifications',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up old activity logs.
   * @param retentionDays Number of days to retain logs (default: 365)
   */
  static async cleanupActivityLogs(retentionDays: number = 365): Promise<CleanupResult> {
    try {
      const cutoffDate = DateTime.now().minus({ days: retentionDays }).toSQL()!

      const deleted = await ActivityLog.query().where('created_at', '<', cutoffDate).delete()

      return { task: 'activity_logs', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'activity_logs',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up old resolved reports.
   * @param retentionDays Number of days to retain resolved reports (default: 180)
   */
  static async cleanupResolvedReports(retentionDays: number = 180): Promise<CleanupResult> {
    try {
      const cutoffDate = DateTime.now().minus({ days: retentionDays }).toSQL()!

      const deleted = await Report.query()
        .whereIn('status', ['resolved', 'rejected'])
        .where('created_at', '<', cutoffDate)
        .delete()

      return { task: 'reports', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'reports',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up old inactive moderated content.
   * @param retentionDays Number of days to retain inactive content (default: 180)
   */
  static async cleanupModeratedContent(retentionDays: number = 180): Promise<CleanupResult> {
    try {
      const cutoffDate = DateTime.now().minus({ days: retentionDays }).toSQL()!

      const deleted = await ModeratedContent.query()
        .where('is_active', false)
        .where('created_at', '<', cutoffDate)
        .delete()

      return { task: 'moderated_content', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'moderated_content',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Sync subscription statuses - expire subscriptions past their expiration date.
   */
  static async syncSubscriptions(): Promise<CleanupResult> {
    try {
      const result = await User.query()
        .where('plan', 'plus')
        .whereNotNull('subscription_expires_at')
        .where('subscription_expires_at', '<', DateTime.now().toSQL()!)
        .whereNot('subscription_status', 'expired')
        .update({
          subscriptionStatus: 'expired',
        })

      return { task: 'subscriptions', deletedCount: 0, updatedCount: result.length }
    } catch (error) {
      return {
        task: 'subscriptions',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Reset chat request limits for users whose reset time has passed.
   */
  static async resetChatLimits(): Promise<CleanupResult> {
    try {
      const result = await User.query()
        .whereNotNull('chat_requests_reset_at')
        .where('chat_requests_reset_at', '<', DateTime.now().toSQL()!)
        .where('chat_requests_count', '>', 0)
        .update({
          chatRequestsCount: 0,
          chatRequestsResetAt: null,
        })

      return { task: 'chat_limits', deletedCount: 0, updatedCount: result.length }
    } catch (error) {
      return {
        task: 'chat_limits',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Auto-unban users whose temporary ban has expired.
   */
  static async processExpiredBans(): Promise<CleanupResult> {
    try {
      const result = await User.query()
        .where('is_banned', true)
        .whereNotNull('banned_until')
        .where('banned_until', '<', DateTime.now().toSQL()!)
        .update({
          isBanned: false,
          bannedUntil: null,
          banReason: null,
          bannedBy: null,
          bannedAt: null,
        })

      return { task: 'expired_bans', deletedCount: 0, updatedCount: result.length }
    } catch (error) {
      return {
        task: 'expired_bans',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Clean up orphaned images from R2 storage.
   * Images that exist in R2 but are not referenced in the database.
   */
  static async cleanupOrphanedImages(): Promise<CleanupResult> {
    try {
      // Collect all active image URLs from the database
      const activeUrls = new Set<string>()

      // User avatars
      const usersWithAvatars = await User.query().whereNotNull('avatar').select('avatar')
      for (const user of usersWithAvatars) {
        if (user.avatar) activeUrls.add(user.avatar)
      }

      // User backdrop images
      const usersWithBackdrops = await User.query()
        .whereNotNull('backdropImage')
        .select('backdropImage')
      for (const user of usersWithBackdrops) {
        if (user.backdropImage) activeUrls.add(user.backdropImage)
      }

      // List backdrop images
      const listsWithBackdrops = await List.query()
        .whereNotNull('backdropImage')
        .select('backdropImage')
      for (const list of listsWithBackdrops) {
        if (list.backdropImage) activeUrls.add(list.backdropImage)
      }

      // List all files in R2 storage directories
      const directories = ['images/user/avatar', 'images/user/backdrop', 'images/list/backdrop']
      let totalDeleted = 0

      for (const directory of directories) {
        const filesInR2 = await ImageStorageService.listFilesInDirectory(directory)

        for (const fileKey of filesInR2) {
          const fullUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`

          if (!activeUrls.has(fullUrl)) {
            const deleted = await ImageStorageService.deleteByUrl(fullUrl)
            if (deleted) totalDeleted++
          }
        }
      }

      return { task: 'orphaned_images', deletedCount: totalDeleted }
    } catch (error) {
      return {
        task: 'orphaned_images',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // ============================================
  // ORPHAN CLEANUP METHODS (Manual execution only)
  // ============================================

  /**
   * Find orphaned books (books with no tracking).
   * @param dryRun If true, only returns count without deleting
   */
  static async cleanupOrphanBooks(dryRun: boolean = true): Promise<CleanupResult> {
    try {
      const orphanQuery = Book.query()
        .whereNotExists((subQuery) => {
          subQuery.from('book_tracking').whereRaw('book_tracking.book_id = books.id')
        })
        .whereNotExists((subQuery) => {
          subQuery.from('list_books').whereRaw('list_books.book_id = books.id')
        })

      if (dryRun) {
        const count = await orphanQuery.count('* as total')
        return { task: 'orphan_books (dry-run)', deletedCount: Number(count[0].$extras.total) || 0 }
      }

      const deleted = await orphanQuery.delete()
      return { task: 'orphan_books', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'orphan_books',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Find orphaned authors (authors with no books).
   * @param dryRun If true, only returns count without deleting
   */
  static async cleanupOrphanAuthors(dryRun: boolean = true): Promise<CleanupResult> {
    try {
      const orphanQuery = Author.query().whereNotExists((subQuery) => {
        subQuery.from('author_books').whereRaw('author_books.author_id = authors.id')
      })

      if (dryRun) {
        const count = await orphanQuery.count('* as total')
        return {
          task: 'orphan_authors (dry-run)',
          deletedCount: Number(count[0].$extras.total) || 0,
        }
      }

      const deleted = await orphanQuery.delete()
      return { task: 'orphan_authors', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'orphan_authors',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Find orphaned publishers (publishers with no books).
   * @param dryRun If true, only returns count without deleting
   */
  static async cleanupOrphanPublishers(dryRun: boolean = true): Promise<CleanupResult> {
    try {
      const orphanQuery = Publisher.query().whereNotExists((subQuery) => {
        subQuery.from('book_publishers').whereRaw('book_publishers.publisher_id = publishers.id')
      })

      if (dryRun) {
        const count = await orphanQuery.count('* as total')
        return {
          task: 'orphan_publishers (dry-run)',
          deletedCount: Number(count[0].$extras.total) || 0,
        }
      }

      const deleted = await orphanQuery.delete()
      return { task: 'orphan_publishers', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'orphan_publishers',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Find orphaned categories (non-featured categories with no books).
   * @param dryRun If true, only returns count without deleting
   */
  static async cleanupOrphanCategories(dryRun: boolean = true): Promise<CleanupResult> {
    try {
      const orphanQuery = Category.query()
        .where((q) => {
          q.where('is_featured', false).orWhereNull('is_featured')
        })
        .whereNotExists((subQuery) => {
          subQuery.from('category_books').whereRaw('category_books.category_id = categories.id')
        })

      if (dryRun) {
        const count = await orphanQuery.count('* as total')
        return {
          task: 'orphan_categories (dry-run)',
          deletedCount: Number(count[0].$extras.total) || 0,
        }
      }

      const deleted = await orphanQuery.delete()
      return { task: 'orphan_categories', deletedCount: deleted.length }
    } catch (error) {
      return {
        task: 'orphan_categories',
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // ============================================
  // AGGREGATE METHODS
  // ============================================

  /**
   * Run all daily maintenance tasks.
   */
  static async runDailyMaintenance(): Promise<MaintenanceReport> {
    const startedAt = DateTime.now()
    const results: CleanupResult[] = []
    const errors: string[] = []

    // Execute all daily tasks
    const tasks = [
      this.cleanupRefreshTokens(),
      this.cleanupPasswordResetTokens(),
      this.cleanupBookRecaps(),
      this.cleanupExpiredStrikes(),
      this.syncSubscriptions(),
      this.resetChatLimits(),
      this.processExpiredBans(),
    ]

    const taskResults = await Promise.all(tasks)
    results.push(...taskResults)

    // Collect errors
    for (const result of results) {
      if (result.error) {
        errors.push(`${result.task}: ${result.error}`)
      }
    }

    const completedAt = DateTime.now()

    return {
      startedAt,
      completedAt,
      results,
      totalDeleted: results.reduce((sum, r) => sum + r.deletedCount, 0),
      totalUpdated: results.reduce((sum, r) => sum + (r.updatedCount || 0), 0),
      errors,
    }
  }

  /**
   * Run all weekly maintenance tasks (includes daily + additional).
   */
  static async runWeeklyMaintenance(): Promise<MaintenanceReport> {
    const startedAt = DateTime.now()
    const results: CleanupResult[] = []
    const errors: string[] = []

    // Run daily tasks first
    const dailyReport = await this.runDailyMaintenance()
    results.push(...dailyReport.results)
    errors.push(...dailyReport.errors)

    // Additional weekly tasks
    const weeklyTasks = [this.cleanupNotifications(90)]

    const weeklyResults = await Promise.all(weeklyTasks)
    results.push(...weeklyResults)

    // Collect errors from weekly tasks
    for (const result of weeklyResults) {
      if (result.error) {
        errors.push(`${result.task}: ${result.error}`)
      }
    }

    const completedAt = DateTime.now()

    return {
      startedAt,
      completedAt,
      results,
      totalDeleted: results.reduce((sum, r) => sum + r.deletedCount, 0),
      totalUpdated: results.reduce((sum, r) => sum + (r.updatedCount || 0), 0),
      errors,
    }
  }

  /**
   * Run all monthly maintenance tasks (includes weekly + additional).
   */
  static async runMonthlyMaintenance(): Promise<MaintenanceReport> {
    const startedAt = DateTime.now()
    const results: CleanupResult[] = []
    const errors: string[] = []

    // Run weekly tasks first
    const weeklyReport = await this.runWeeklyMaintenance()
    results.push(...weeklyReport.results)
    errors.push(...weeklyReport.errors)

    // Additional monthly tasks
    const monthlyTasks = [
      this.cleanupActivityLogs(365),
      this.cleanupResolvedReports(180),
      this.cleanupModeratedContent(180),
      this.cleanupOrphanedImages(),
    ]

    const monthlyResults = await Promise.all(monthlyTasks)
    results.push(...monthlyResults)

    // Collect errors from monthly tasks
    for (const result of monthlyResults) {
      if (result.error) {
        errors.push(`${result.task}: ${result.error}`)
      }
    }

    const completedAt = DateTime.now()

    return {
      startedAt,
      completedAt,
      results,
      totalDeleted: results.reduce((sum, r) => sum + r.deletedCount, 0),
      totalUpdated: results.reduce((sum, r) => sum + (r.updatedCount || 0), 0),
      errors,
    }
  }

  /**
   * Run orphan cleanup (manual only - not scheduled).
   * @param dryRun If true, only reports what would be deleted
   */
  static async runOrphanCleanup(dryRun: boolean = true): Promise<MaintenanceReport> {
    const startedAt = DateTime.now()
    const results: CleanupResult[] = []
    const errors: string[] = []

    const tasks = [
      this.cleanupOrphanAuthors(dryRun),
      this.cleanupOrphanPublishers(dryRun),
      this.cleanupOrphanCategories(dryRun),
      this.cleanupOrphanBooks(dryRun),
    ]

    const taskResults = await Promise.all(tasks)
    results.push(...taskResults)

    for (const result of results) {
      if (result.error) {
        errors.push(`${result.task}: ${result.error}`)
      }
    }

    const completedAt = DateTime.now()

    return {
      startedAt,
      completedAt,
      results,
      totalDeleted: results.reduce((sum, r) => sum + r.deletedCount, 0),
      totalUpdated: results.reduce((sum, r) => sum + (r.updatedCount || 0), 0),
      errors,
    }
  }

  /**
   * Get database statistics for monitoring.
   */
  static async getDatabaseStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {}

    const tables = [
      { name: 'users', model: User },
      { name: 'books', model: Book },
      { name: 'refresh_tokens', model: RefreshToken },
      { name: 'password_reset_tokens', model: PasswordResetToken },
      { name: 'book_recaps', model: BookRecap },
      { name: 'user_strikes', model: UserStrike },
      { name: 'notifications', model: Notification },
      { name: 'activity_logs', model: ActivityLog },
      { name: 'reports', model: Report },
      { name: 'moderated_content', model: ModeratedContent },
      { name: 'authors', model: Author },
      { name: 'publishers', model: Publisher },
    ]

    for (const { name, model } of tables) {
      try {
        const count = await model.query().count('* as total')
        stats[name] = Number(count[0].$extras.total) || 0
      } catch {
        stats[name] = -1
      }
    }

    // Get specific counts
    try {
      const expiredTokens = await RefreshToken.query()
        .where('expires_at', '<', DateTime.now().toSQL()!)
        .count('* as total')
      stats['expired_refresh_tokens'] = Number(expiredTokens[0].$extras.total) || 0
    } catch {
      stats['expired_refresh_tokens'] = -1
    }

    try {
      const expiredRecaps = await BookRecap.query()
        .whereNotNull('expires_at')
        .where('expires_at', '<', DateTime.now().toSQL()!)
        .count('* as total')
      stats['expired_book_recaps'] = Number(expiredRecaps[0].$extras.total) || 0
    } catch {
      stats['expired_book_recaps'] = -1
    }

    return stats
  }
}
