import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export type NotificationType = 'review_like' | 'list_like' | 'list_save'
export type ResourceType = 'book_review' | 'list'

export default class Notification extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare userId: string

  @column()
  declare actorId: string

  @column()
  declare type: NotificationType

  @column()
  declare resourceType: ResourceType

  @column()
  declare resourceId: string

  @column()
  declare read: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // Relations
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  // Property for enriched resource (book_review, list)
  declare resource?: any
}
