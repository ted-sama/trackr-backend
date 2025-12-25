import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Book from '#models/book'

export default class ChatBookUsage extends BaseModel {
  public static table = 'chat_book_usage'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: string

  @column()
  declare bookId: number

  @column()
  declare totalRequests: number

  @column()
  declare monthlyRequests: number

  @column.dateTime()
  declare lastResetAt: DateTime | null

  @column.dateTime()
  declare lastUsedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Book)
  declare book: BelongsTo<typeof Book>

  /**
   * Increment usage for a book, handling monthly reset if needed
   */
  static async incrementUsage(
    userId: string,
    bookId: number,
    userResetAt: DateTime | null
  ): Promise<ChatBookUsage> {
    const now = DateTime.now()

    // Find or create usage record
    let usage = await ChatBookUsage.query()
      .where('user_id', userId)
      .where('book_id', bookId)
      .first()

    if (!usage) {
      usage = new ChatBookUsage()
      usage.userId = userId
      usage.bookId = bookId
      usage.totalRequests = 0
      usage.monthlyRequests = 0
      usage.lastResetAt = now
    }

    // Check if we need to reset monthly count
    // Reset if: user's reset date has passed since our last reset
    if (userResetAt && usage.lastResetAt && now > userResetAt && usage.lastResetAt < userResetAt) {
      usage.monthlyRequests = 0
      usage.lastResetAt = now
    } else if (!usage.lastResetAt) {
      usage.lastResetAt = now
    }

    // Increment counters
    usage.totalRequests += 1
    usage.monthlyRequests += 1
    usage.lastUsedAt = now

    await usage.save()
    return usage
  }

  /**
   * Get usage stats for a user with book details
   */
  static async getUserUsageStats(userId: string, userResetAt: DateTime | null) {
    const usages = await ChatBookUsage.query()
      .where('user_id', userId)
      .preload('book')
      .orderBy('total_requests', 'desc')

    const now = DateTime.now()

    // Process each usage to check for monthly reset
    return usages.map((usage) => {
      let monthlyRequests = usage.monthlyRequests

      // If user's reset date has passed since our last reset, monthly count should be 0
      if (
        userResetAt &&
        usage.lastResetAt &&
        now > userResetAt &&
        usage.lastResetAt < userResetAt
      ) {
        monthlyRequests = 0
      }

      return {
        bookId: usage.bookId,
        book: usage.book
          ? {
              id: usage.book.id,
              title: usage.book.title,
              coverImage: usage.book.coverImage,
              type: usage.book.type,
            }
          : null,
        totalRequests: usage.totalRequests,
        monthlyRequests,
        lastUsedAt: usage.lastUsedAt,
      }
    })
  }
}
