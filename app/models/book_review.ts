import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany, manyToMany, beforeSave } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Book from '#models/book'
import BookReviewRevision from '#models/book_review_revision'
import ContentFilterService from '#services/content_filter_service'

export default class BookReview extends BaseModel {
  public static table = 'book_reviews'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: string

  @column()
  declare bookId: number

  @column()
  declare content: string

  @column()
  declare rating: number | null

  @column()
  declare likesCount: number

  @column()
  declare revisionsCount: number

  @column()
  declare isSpoiler: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Book)
  declare book: BelongsTo<typeof Book>

  @hasMany(() => BookReviewRevision, {
    foreignKey: 'reviewId',
  })
  declare revisions: HasMany<typeof BookReviewRevision>

  @manyToMany(() => User, {
    pivotTable: 'book_review_likes',
    pivotForeignKey: 'review_id',
    pivotRelatedForeignKey: 'user_id',
    pivotTimestamps: {
      createdAt: 'created_at',
      updatedAt: false,
    },
    serializeAs: null,
  })
  declare likedBy: ManyToMany<typeof User>

  public isLikedBy(userId: string): boolean {
    if (!this.$preloaded.likedBy) {
      return false
    }
    return this.likedBy.some((user) => user.id === userId)
  }

  @beforeSave()
  static async validateContent(review: BookReview) {
    // Validate and censor review content
    if (review.$dirty.content) {
      const contentCheck = ContentFilterService.validateAndCensor(
        review.content,
        'review_content',
        {
          autoReject: false,
          autoCensor: true,
        }
      )
      if (contentCheck.content !== review.content && review.userId) {
        await ContentFilterService.logModeration(
          review.userId,
          'review_content',
          review.content,
          contentCheck.content,
          contentCheck.reason!,
          review.id?.toString() ?? null
        )
        review.content = contentCheck.content
      }
    }
  }
}
