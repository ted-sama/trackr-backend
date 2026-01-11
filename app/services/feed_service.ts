import { DateTime } from 'luxon'
import Book from '#models/book'
import BookTracking from '#models/book_tracking'
import BookReview from '#models/book_review'
import db from '@adonisjs/lucid/services/db'
import FollowService from '#services/follow_service'

export interface RecentlyRatedUser {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
}

export interface RecentlyRatedItem {
  book: Book
  user: RecentlyRatedUser
  rating: number
  hasReview: boolean
  reviewId: number | null
  ratedAt: DateTime
}

export default class FeedService {
  /**
   * Get books that are popular among users the current user follows
   * Returns books tracked by at least minCount followed users
   */
  static async getPopularAmongFollowing(
    userId: string,
    minCount: number = 2,
    limit: number = 20
  ): Promise<Book[]> {
    // Get list of user IDs that the current user follows
    const followingIds = await FollowService.getFollowingIds(userId)

    if (followingIds.length === 0) {
      return []
    }

    // Get books tracked by multiple followed users, ordered by count
    const popularBookIds = await db
      .from('book_tracking')
      .select('book_id')
      .whereIn('user_id', followingIds)
      .groupBy('book_id')
      .havingRaw('COUNT(*) >= ?', [minCount])
      .orderByRaw('COUNT(*) DESC')
      .limit(limit)

    if (popularBookIds.length === 0) {
      return []
    }

    const bookIds = popularBookIds.map((row) => row.book_id)

    // Fetch full book data with authors
    const books = await Book.query()
      .whereIn('id', bookIds)
      .preload('authors')
      .preload('publishers')

    // Sort books by the order from the query (most tracked first)
    const bookMap = new Map(books.map((book) => [book.id, book]))
    return bookIds.map((id) => bookMap.get(id)).filter((book): book is Book => book !== undefined)
  }

  /**
   * Get books recently rated by users the current user follows
   * Only returns books that have been rated (not just marked completed)
   */
  static async getRecentlyRatedByFollowing(
    userId: string,
    daysBack: number = 7,
    limit: number = 20
  ): Promise<RecentlyRatedItem[]> {
    // Get list of user IDs that the current user follows
    const followingIds = await FollowService.getFollowingIds(userId)

    if (followingIds.length === 0) {
      return []
    }

    // Calculate cutoff date
    const cutoffDate = DateTime.now().minus({ days: daysBack }).toSQL()

    // Get recent book trackings with ratings from followed users
    const recentTrackings = await BookTracking.query()
      .whereIn('user_id', followingIds)
      .whereNotNull('rating')
      .where('updated_at', '>=', cutoffDate!)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .preload('user')
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors').preload('publishers')
      })

    if (recentTrackings.length === 0) {
      return []
    }

    // Get review IDs for these book/user combinations
    const bookUserPairs = recentTrackings.map((t) => ({
      bookId: t.bookId,
      userId: t.userId,
    }))

    // Batch query for reviews
    const reviews = await BookReview.query()
      .where((query) => {
        for (const pair of bookUserPairs) {
          query.orWhere((subquery) => {
            subquery.where('book_id', pair.bookId).where('user_id', pair.userId)
          })
        }
      })
      .select('id', 'book_id', 'user_id')

    // Create a map for quick review lookup
    const reviewMap = new Map<string, number>()
    for (const review of reviews) {
      const key = `${review.bookId}-${review.userId}`
      reviewMap.set(key, review.id)
    }

    // Build the result
    return recentTrackings.map((tracking) => {
      const reviewKey = `${tracking.bookId}-${tracking.userId}`
      const reviewId = reviewMap.get(reviewKey) ?? null

      return {
        book: tracking.book,
        user: {
          id: tracking.user.id,
          username: tracking.user.username,
          displayName: tracking.user.displayName,
          avatar: tracking.user.avatar,
        },
        rating: tracking.rating!,
        hasReview: reviewId !== null,
        reviewId,
        ratedAt: tracking.updatedAt,
      }
    })
  }

  /**
   * Get the count of followed users tracking each book (for displaying in UI)
   */
  static async getFollowingTrackingCounts(
    userId: string,
    bookIds: number[]
  ): Promise<Map<number, number>> {
    if (bookIds.length === 0) {
      return new Map()
    }

    const followingIds = await FollowService.getFollowingIds(userId)

    if (followingIds.length === 0) {
      return new Map()
    }

    const counts = await db
      .from('book_tracking')
      .select('book_id')
      .count('* as count')
      .whereIn('user_id', followingIds)
      .whereIn('book_id', bookIds)
      .groupBy('book_id')

    const result = new Map<number, number>()
    for (const row of counts) {
      result.set(row.book_id, Number(row.count))
    }

    return result
  }
}
