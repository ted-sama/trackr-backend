import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import User from '#models/user'

export type ModerationResourceType =
  | 'username'
  | 'display_name'
  | 'list_name'
  | 'list_description'
  | 'list_tags'
  | 'book_notes'
  | 'review_content'

export type ModerationAction = 'warning' | 'auto_censored' | 'deleted' | 'user_banned'
export type ModerationReason = 'profanity' | 'hate_speech' | 'spam' | 'harassment' | 'reported'

export default class ModeratedContent extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignUuid(moderatedContent: ModeratedContent) {
    moderatedContent.id = randomUUID()
  }

  @column()
  declare userId: string

  @column()
  declare resourceType: ModerationResourceType

  @column()
  declare resourceId: string | null

  @column()
  declare originalContent: string

  @column()
  declare censoredContent: string | null

  @column()
  declare action: ModerationAction

  @column()
  declare reason: ModerationReason

  @column()
  declare moderatedBy: string | null

  @column()
  declare moderatorNotes: string | null

  @column()
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, {
    foreignKey: 'userId',
  })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, {
    foreignKey: 'moderatedBy',
  })
  declare moderator: BelongsTo<typeof User>
}
