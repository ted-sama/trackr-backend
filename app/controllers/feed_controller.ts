import type { HttpContext } from '@adonisjs/core/http'
import FeedService from '#services/feed_service'

export default class FeedController {
  /**
   * @summary Get popular books among followed users
   * @tag Feed
   * @description Returns books that are tracked by at least 2 users the current user follows
   * @responseBody 200 - { title: string, books: Book[] }
   * @responseBody 401 - Unauthorized
   */
  async popularAmongFollowing({ auth, response }: HttpContext) {
    const currentUser = await auth.authenticate()

    const books = await FeedService.getPopularAmongFollowing(currentUser.id, 2, 20)

    // Format as a category-like object for frontend compatibility
    return response.ok({
      id: 'popular-among-following',
      title: 'Popular with people you follow',
      titleFr: 'Populaire chez vos abonnements',
      description: 'Books tracked by people you follow',
      descriptionFr: 'Livres suivis par vos abonnements',
      isFeatured: false,
      books: books.map((book) => book.serialize()),
    })
  }

  /**
   * @summary Get recently rated books by followed users
   * @tag Feed
   * @description Returns books that were rated in the last 7 days by users the current user follows
   * @responseBody 200 - RecentlyRatedItem[]
   * @responseBody 401 - Unauthorized
   */
  async recentlyRated({ auth, response }: HttpContext) {
    const currentUser = await auth.authenticate()

    const items = await FeedService.getRecentlyRatedByFollowing(currentUser.id, 7, 20)

    // Serialize the data
    const serialized = items.map((item) => ({
      book: item.book.serialize(),
      user: item.user,
      rating: item.rating,
      hasReview: item.hasReview,
      reviewId: item.reviewId,
      ratedAt: item.ratedAt.toISO(),
    }))

    return response.ok(serialized)
  }
}
