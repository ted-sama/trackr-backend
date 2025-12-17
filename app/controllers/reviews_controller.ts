import BookReview from '#models/book_review'
import BookReviewRevision from '#models/book_review_revision'
import Book from '#models/book'
import User from '#models/user'
import BookTracking from '#models/book_tracking'
import AppError from '#exceptions/app_error'
import { ActivityLogger } from '#services/activity_logger'
import {
  createReviewSchema,
  updateReviewSchema,
  showReviewSchema,
  deleteReviewSchema,
  likeReviewSchema,
  indexReviewsSchema,
  userReviewsSchema,
  myReviewSchema,
} from '#validators/review'
import type { HttpContext } from '@adonisjs/core/http'

export default class ReviewsController {
  /**
   * Get reviews for a book
   * GET /books/:bookId/reviews
   */
  public async index({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(indexReviewsSchema)
    const { bookId } = payload.params
    const sort = payload.sort || 'recent'
    const page = payload.page || 1
    const limit = 20

    // Try to authenticate user (optional for this endpoint)
    let user = null
    try {
      user = await auth.authenticate()
    } catch {
      // User not authenticated, continue as guest
    }

    // Verify book exists
    const book = await Book.find(bookId)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    // Build query
    let query = BookReview.query().where('book_id', bookId).preload('user').preload('likedBy')

    // Apply sorting
    switch (sort) {
      case 'popular':
        query = query.orderBy('likes_count', 'desc').orderBy('created_at', 'desc')
        break
      case 'highest_rated':
        query = query.orderBy('rating', 'desc').orderBy('created_at', 'desc')
        break
      case 'lowest_rated':
        query = query.orderBy('rating', 'asc').orderBy('created_at', 'desc')
        break
      case 'recent':
      default:
        query = query.orderBy('created_at', 'desc')
        break
    }

    const reviews = await query.paginate(page, limit)

    const serializedReviews = reviews.serialize({
      relations: {
        user: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    // Enrich with user context
    serializedReviews.data = serializedReviews.data.map((review: any) => {
      const reviewModel = reviews.all().find((r) => r.id === review.id)
      if (reviewModel && user) {
        review.isLikedByMe = reviewModel.isLikedBy(user.id)
      } else {
        review.isLikedByMe = false
      }
      return review
    })

    return response.ok(serializedReviews)
  }

  /**
   * Get the current user's review for a book
   * GET /books/:bookId/reviews/me
   */
  public async myReview({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(myReviewSchema)
    const { bookId } = payload.params

    // Verify book exists
    const book = await Book.find(bookId)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    // Find user's review for this book
    const review = await BookReview.query()
      .where('user_id', user.id)
      .where('book_id', bookId)
      .preload('user')
      .preload('likedBy')
      .first()

    if (!review) {
      return response.ok(null)
    }

    const serialized = review.serialize({
      relations: {
        user: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    serialized.isLikedByMe = review.isLikedBy(user.id)

    return response.ok(serialized)
  }

  /**
   * Create a new review
   * POST /books/:bookId/reviews
   */
  public async store({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(createReviewSchema)
    const { bookId } = payload.params
    const { content, isSpoiler } = payload

    // Verify book exists
    const book = await Book.find(bookId)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    // Verify user has tracked and rated this book
    const tracking = await BookTracking.query()
      .where('user_id', user.id)
      .where('book_id', bookId)
      .first()

    if (!tracking) {
      throw new AppError('You must track this book before writing a review', {
        status: 403,
        code: 'BOOK_NOT_TRACKED',
      })
    }

    if (tracking.rating === null) {
      throw new AppError('You must rate this book before writing a review', {
        status: 403,
        code: 'BOOK_NOT_RATED',
      })
    }

    // Check if review already exists
    const existingReview = await BookReview.query()
      .where('user_id', user.id)
      .where('book_id', bookId)
      .first()

    if (existingReview) {
      throw new AppError('You already have a review for this book', {
        status: 409,
        code: 'REVIEW_ALREADY_EXISTS',
      })
    }

    // Create review with the current rating
    const review = await BookReview.create({
      userId: user.id,
      bookId,
      content,
      rating: tracking.rating,
      likesCount: 0,
      revisionsCount: 0,
      isSpoiler: isSpoiler ?? false,
    })

    await review.load('user')

    // Log activity
    await ActivityLogger.log({
      userId: user.id,
      action: 'book.reviewCreated',
      resourceType: 'book',
      resourceId: bookId,
      metadata: {
        reviewId: review.id,
        rating: tracking.rating,
        contentLength: content.length,
      },
    })

    return response.created(
      review.serialize({
        relations: {
          user: {
            fields: {
              pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
            },
          },
        },
      })
    )
  }

  /**
   * Get a specific review with revisions
   * GET /books/:bookId/reviews/:id
   */
  public async show({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(showReviewSchema)
    const { bookId, id } = payload.params

    // Try to authenticate user (optional for this endpoint)
    let user = null
    try {
      user = await auth.authenticate()
    } catch {
      // User not authenticated, continue as guest
    }

    const review = await BookReview.query()
      .where('id', id)
      .where('book_id', bookId)
      .preload('user')
      .preload('likedBy')
      .preload('revisions', (query) => {
        query.orderBy('created_at', 'desc')
      })
      .first()

    if (!review) {
      throw new AppError('Review not found', {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      })
    }

    const serialized = review.serialize({
      relations: {
        user: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
        revisions: {
          fields: {
            pick: ['id', 'content', 'rating', 'createdAt'],
          },
        },
      },
    })

    if (user) {
      serialized.isLikedByMe = review.isLikedBy(user.id)
    } else {
      serialized.isLikedByMe = false
    }

    return response.ok(serialized)
  }

  /**
   * Update a review (creates a revision)
   * PATCH /books/:bookId/reviews/:id
   */
  public async update({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(updateReviewSchema)
    const { bookId, id } = payload.params
    const { content, isSpoiler } = payload

    const review = await BookReview.query().where('id', id).where('book_id', bookId).first()

    if (!review) {
      throw new AppError('Review not found', {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      })
    }

    // Check ownership
    if (review.userId !== user.id) {
      throw new AppError('You can only update your own reviews', {
        status: 403,
        code: 'REVIEW_NOT_OWNED',
      })
    }

    // Get current rating from tracking
    const tracking = await BookTracking.query()
      .where('user_id', user.id)
      .where('book_id', bookId)
      .first()

    if (!tracking || tracking.rating === null) {
      throw new AppError('You must have a rating for this book to update the review', {
        status: 403,
        code: 'BOOK_NOT_RATED',
      })
    }

    // Save current content and rating as revision
    await BookReviewRevision.create({
      reviewId: review.id,
      content: review.content,
      rating: review.rating,
    })

    // Update review with new content and current rating
    review.content = content
    review.rating = tracking.rating
    review.revisionsCount += 1
    if (isSpoiler !== undefined) {
      review.isSpoiler = isSpoiler
    }
    await review.save()

    await review.load('user')

    // Log activity
    await ActivityLogger.log({
      userId: user.id,
      action: 'book.reviewUpdated',
      resourceType: 'book',
      resourceId: bookId,
      metadata: {
        reviewId: review.id,
        rating: tracking.rating,
        contentLength: content.length,
        revisionsCount: review.revisionsCount,
      },
    })

    return response.ok(
      review.serialize({
        relations: {
          user: {
            fields: {
              pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
            },
          },
        },
      })
    )
  }

  /**
   * Delete a review (cascades to revisions and likes)
   * DELETE /books/:bookId/reviews/:id
   */
  public async destroy({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(deleteReviewSchema)
    const { bookId, id } = payload.params

    const review = await BookReview.query().where('id', id).where('book_id', bookId).first()

    if (!review) {
      throw new AppError('Review not found', {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      })
    }

    // Check ownership
    if (review.userId !== user.id) {
      throw new AppError('You can only delete your own reviews', {
        status: 403,
        code: 'REVIEW_NOT_OWNED',
      })
    }

    // Store data for logging before deletion
    const reviewData = {
      reviewId: review.id,
      bookId: review.bookId,
      likesCount: review.likesCount,
      revisionsCount: review.revisionsCount,
    }

    await review.delete()

    // Log activity
    await ActivityLogger.log({
      userId: user.id,
      action: 'book.reviewDeleted',
      resourceType: 'book',
      resourceId: reviewData.bookId,
      metadata: reviewData,
    })

    return response.noContent()
  }

  /**
   * Like a review
   * POST /books/:bookId/reviews/:id/like
   */
  public async like({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(likeReviewSchema)
    const { bookId, id } = payload.params

    const review = await BookReview.query()
      .where('id', id)
      .where('book_id', bookId)
      .preload('likedBy')
      .first()

    if (!review) {
      throw new AppError('Review not found', {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      })
    }

    // Check if already liked
    if (review.isLikedBy(user.id)) {
      throw new AppError('You have already liked this review', {
        status: 409,
        code: 'REVIEW_ALREADY_LIKED',
      })
    }

    // Add like
    await review.related('likedBy').attach([user.id])

    // Increment likes count without updating updatedAt
    await BookReview.query().where('id', id).increment('likes_count', 1)

    return response.ok({ message: 'Review liked successfully' })
  }

  /**
   * Unlike a review
   * DELETE /books/:bookId/reviews/:id/like
   */
  public async unlike({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(likeReviewSchema)
    const { bookId, id } = payload.params

    const review = await BookReview.query()
      .where('id', id)
      .where('book_id', bookId)
      .preload('likedBy')
      .first()

    if (!review) {
      throw new AppError('Review not found', {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      })
    }

    // Check if not liked
    if (!review.isLikedBy(user.id)) {
      throw new AppError('You have not liked this review', {
        status: 409,
        code: 'REVIEW_NOT_LIKED',
      })
    }

    // Remove like
    await review.related('likedBy').detach([user.id])

    // Decrement likes count without updating updatedAt
    await BookReview.query()
      .where('id', id)
      .where('likes_count', '>', 0)
      .decrement('likes_count', 1)

    return response.ok({ message: 'Review unliked successfully' })
  }

  /**
   * Get reviews by a user
   * GET /users/:username/reviews
   */
  public async userReviews({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(userReviewsSchema)
    const { username } = payload.params
    const page = payload.page || 1
    const limit = 20

    // Try to authenticate user (optional for this endpoint)
    let currentUser = null
    try {
      currentUser = await auth.authenticate()
    } catch {
      // User not authenticated, continue as guest
    }

    // Find user
    const user = await User.findBy('username', username)
    if (!user) {
      throw new AppError('User not found', {
        status: 404,
        code: 'USER_NOT_FOUND',
      })
    }

    // Get reviews
    const reviews = await BookReview.query()
      .where('user_id', user.id)
      .preload('user')
      .preload('book', (query) => {
        query.preload('authors').preload('publishers')
      })
      .preload('likedBy')
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    const serializedReviews = reviews.serialize({
      relations: {
        user: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    // Enrich with user context
    serializedReviews.data = serializedReviews.data.map((review: any) => {
      const reviewModel = reviews.all().find((r) => r.id === review.id)
      if (reviewModel && currentUser) {
        review.isLikedByMe = reviewModel.isLikedBy(currentUser.id)
      } else {
        review.isLikedByMe = false
      }
      return review
    })

    return response.ok(serializedReviews)
  }
}
