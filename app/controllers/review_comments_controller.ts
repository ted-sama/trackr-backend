import ReviewComment from '#models/review_comment'
import BookReview from '#models/book_review'
import User from '#models/user'
import AppError from '#exceptions/app_error'
import NotificationService from '#services/notification_service'
import {
  indexCommentsSchema,
  createCommentSchema,
  updateCommentSchema,
  deleteCommentSchema,
  toggleLikeCommentSchema,
} from '#validators/review_comment'
import type { HttpContext } from '@adonisjs/core/http'

export default class ReviewCommentsController {
  /**
   * Get comments for a review with nested replies
   * GET /reviews/:reviewId/comments
   */
  public async index({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(indexCommentsSchema)
    const { reviewId } = payload.params
    const page = payload.page || 1
    const limit = 20

    // Try to authenticate user (optional for this endpoint)
    let user = null
    try {
      user = await auth.authenticate()
    } catch {
      // User not authenticated, continue as guest
    }

    // Verify review exists
    const review = await BookReview.find(reviewId)
    if (!review) {
      throw new AppError('Review not found', {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      })
    }

    // Get top-level comments (no parent)
    const comments = await ReviewComment.query()
      .where('review_id', reviewId)
      .whereNull('parent_id')
      .preload('user')
      .preload('likedBy')
      .preload('replies', (repliesQuery) => {
        repliesQuery.preload('user').preload('likedBy').orderBy('created_at', 'asc')
      })
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    const serializedComments = comments.serialize({
      relations: {
        user: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
        replies: {
          relations: {
            user: {
              fields: {
                pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
              },
            },
          },
        },
      },
    })

    // Enrich with user context
    serializedComments.data = serializedComments.data.map((comment: any) => {
      const commentModel = comments.all().find((c) => c.id === comment.id)
      if (commentModel && user) {
        comment.isLikedByMe = commentModel.isLikedBy(user.id)
        // Also check replies
        if (comment.replies && Array.isArray(comment.replies)) {
          comment.replies = comment.replies.map((reply: any) => {
            const replyModel = commentModel.replies.find((r) => r.id === reply.id)
            if (replyModel) {
              reply.isLikedByMe = replyModel.isLikedBy(user.id)
            } else {
              reply.isLikedByMe = false
            }
            return reply
          })
        }
      } else {
        comment.isLikedByMe = false
        if (comment.replies && Array.isArray(comment.replies)) {
          comment.replies = comment.replies.map((reply: any) => {
            reply.isLikedByMe = false
            return reply
          })
        }
      }
      return comment
    })

    return response.ok(serializedComments)
  }

  /**
   * Create a new comment
   * POST /reviews/:reviewId/comments
   */
  public async store({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(createCommentSchema)
    const { reviewId } = payload.params
    const { content, parentId, mentions } = payload

    // Verify review exists
    const review = await BookReview.query().where('id', reviewId).preload('user').first()
    if (!review) {
      throw new AppError('Review not found', {
        status: 404,
        code: 'REVIEW_NOT_FOUND',
      })
    }

    // If parentId is provided, verify it exists and enforce 1-level nesting
    if (parentId) {
      const parentComment = await ReviewComment.query()
        .where('id', parentId)
        .where('review_id', reviewId)
        .first()

      if (!parentComment) {
        throw new AppError('Parent comment not found', {
          status: 404,
          code: 'PARENT_COMMENT_NOT_FOUND',
        })
      }

      // Enforce 1-level nesting: parent comment must not have a parent itself
      if (parentComment.parentId !== null) {
        throw new AppError('Cannot reply to a reply. Only 1 level of nesting is allowed', {
          status: 400,
          code: 'NESTED_REPLY_NOT_ALLOWED',
        })
      }
    }

    // Verify mentioned users exist
    if (mentions && mentions.length > 0) {
      const users = await User.query().whereIn('id', mentions)
      if (users.length !== mentions.length) {
        throw new AppError('One or more mentioned users do not exist', {
          status: 400,
          code: 'INVALID_MENTIONS',
        })
      }
    }

    // Create comment
    const comment = await ReviewComment.create({
      reviewId,
      userId: user.id,
      parentId: parentId || null,
      content,
      likesCount: 0,
    })

    // Add mentions if provided
    if (mentions && mentions.length > 0) {
      await comment.related('mentions').attach(mentions)
    }

    await comment.load('user')

    // Create notification for review author (if not the same user)
    if (review.userId !== user.id) {
      await NotificationService.create({
        userId: review.userId,
        actorId: user.id,
        type: 'review_comment',
        resourceType: 'book_review',
        resourceId: review.id,
      })
    }

    // Create notifications for mentioned users
    if (mentions && mentions.length > 0) {
      for (const mentionedUserId of mentions) {
        if (mentionedUserId !== user.id) {
          await NotificationService.create({
            userId: mentionedUserId,
            actorId: user.id,
            type: 'comment_mention',
            resourceType: 'review_comment',
            resourceId: comment.id,
          })
        }
      }
    }

    return response.created(
      comment.serialize({
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
   * Update a comment
   * PATCH /comments/:id
   */
  public async update({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(updateCommentSchema)
    const { id } = payload.params
    const { content } = payload

    const comment = await ReviewComment.find(id)

    if (!comment) {
      throw new AppError('Comment not found', {
        status: 404,
        code: 'COMMENT_NOT_FOUND',
      })
    }

    // Check ownership
    if (comment.userId !== user.id) {
      throw new AppError('You can only update your own comments', {
        status: 403,
        code: 'COMMENT_NOT_OWNED',
      })
    }

    // Update comment
    comment.content = content
    await comment.save()

    await comment.load('user')

    return response.ok(
      comment.serialize({
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
   * Delete a comment
   * DELETE /comments/:id
   */
  public async destroy({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(deleteCommentSchema)
    const { id } = payload.params

    const comment = await ReviewComment.find(id)

    if (!comment) {
      throw new AppError('Comment not found', {
        status: 404,
        code: 'COMMENT_NOT_FOUND',
      })
    }

    // Check ownership
    if (comment.userId !== user.id) {
      throw new AppError('You can only delete your own comments', {
        status: 403,
        code: 'COMMENT_NOT_OWNED',
      })
    }

    await comment.delete()

    return response.noContent()
  }

  /**
   * Toggle like on a comment
   * POST /comments/:id/like
   */
  public async toggleLike({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(toggleLikeCommentSchema)
    const { id } = payload.params

    const comment = await ReviewComment.query().where('id', id).preload('likedBy').first()

    if (!comment) {
      throw new AppError('Comment not found', {
        status: 404,
        code: 'COMMENT_NOT_FOUND',
      })
    }

    const isLiked = comment.isLikedBy(user.id)

    if (isLiked) {
      // Unlike
      await comment.related('likedBy').detach([user.id])

      // Decrement likes count
      await ReviewComment.query()
        .where('id', id)
        .where('likes_count', '>', 0)
        .decrement('likes_count', 1)

      // Delete notification
      await NotificationService.delete({
        userId: comment.userId,
        actorId: user.id,
        type: 'comment_like',
        resourceType: 'review_comment',
        resourceId: comment.id,
      })

      return response.ok({ message: 'Comment unliked successfully', liked: false })
    } else {
      // Like
      await comment.related('likedBy').attach([user.id])

      // Increment likes count
      await ReviewComment.query().where('id', id).increment('likes_count', 1)

      // Create notification (if not own comment)
      if (comment.userId !== user.id) {
        await NotificationService.create({
          userId: comment.userId,
          actorId: user.id,
          type: 'comment_like',
          resourceType: 'review_comment',
          resourceId: comment.id,
        })
      }

      return response.ok({ message: 'Comment liked successfully', liked: true })
    }
  }
}
