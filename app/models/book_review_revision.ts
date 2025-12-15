import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import BookReview from '#models/book_review'

export default class BookReviewRevision extends BaseModel {
  public static table = 'book_review_revisions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare reviewId: number

  @column()
  declare content: string

  @column()
  declare rating: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => BookReview, {
    foreignKey: 'reviewId',
  })
  declare review: BelongsTo<typeof BookReview>
}
