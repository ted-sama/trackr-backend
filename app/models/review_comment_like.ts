import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ReviewCommentLike extends BaseModel {
  public static table = 'review_comment_likes'

  @column({ isPrimary: true })
  declare userId: string

  @column({ isPrimary: true })
  declare commentId: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
