import { DateTime } from 'luxon'
import {
  BaseModel,
  column,
  belongsTo,
  hasMany,
  manyToMany,
  beforeCreate,
  beforeSave,
} from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import User from '#models/user'
import BookReview from '#models/book_review'
import AdvancedContentFilterService from '#services/advanced_content_filter_service'

export default class ReviewComment extends BaseModel {
  public static table = 'review_comments'

  @column({ isPrimary: true })
  declare id: string

  @column()
  declare reviewId: number

  @column()
  declare userId: string

  @column()
  declare parentId: string | null

  @column()
  declare content: string

  @column()
  declare likesCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => BookReview, {
    foreignKey: 'reviewId',
  })
  declare review: BelongsTo<typeof BookReview>

  @belongsTo(() => ReviewComment, {
    foreignKey: 'parentId',
  })
  declare parent: BelongsTo<typeof ReviewComment>

  @hasMany(() => ReviewComment, {
    foreignKey: 'parentId',
  })
  declare replies: HasMany<typeof ReviewComment>

  @manyToMany(() => User, {
    pivotTable: 'review_comment_likes',
    pivotForeignKey: 'comment_id',
    pivotRelatedForeignKey: 'user_id',
    pivotTimestamps: {
      createdAt: 'created_at',
      updatedAt: false,
    },
    serializeAs: null,
  })
  declare likedBy: ManyToMany<typeof User>

  @manyToMany(() => User, {
    pivotTable: 'review_comment_mentions',
    pivotForeignKey: 'comment_id',
    pivotRelatedForeignKey: 'mentioned_user_id',
    pivotTimestamps: {
      createdAt: 'created_at',
      updatedAt: false,
    },
    serializeAs: null,
  })
  declare mentions: ManyToMany<typeof User>

  public isLikedBy(userId: string): boolean {
    if (!this.$preloaded.likedBy) {
      return false
    }
    return this.likedBy.some((user) => user.id === userId)
  }

  @beforeCreate()
  static async assignUuid(comment: ReviewComment) {
    comment.id = randomUUID()
  }

  @beforeSave()
  static async validateContent(comment: ReviewComment) {
    // Validate and censor comment content
    if (comment.$dirty.content) {
      const contentCheck = AdvancedContentFilterService.validateAndCensor(
        comment.content,
        'comment_content',
        {
          autoReject: false,
          autoCensor: true,
        }
      )
      if (contentCheck.content !== comment.content && comment.userId) {
        await AdvancedContentFilterService.logModeration(
          comment.userId,
          'comment_content',
          comment.content,
          contentCheck.content,
          contentCheck.reason!,
          comment.id ?? null
        )
        comment.content = contentCheck.content
      }
    }
  }
}
