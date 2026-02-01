import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ReviewCommentMention extends BaseModel {
  public static table = 'review_comment_mentions'

  @column({ isPrimary: true })
  declare commentId: string

  @column({ isPrimary: true })
  declare mentionedUserId: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
