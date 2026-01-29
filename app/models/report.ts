import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import User from '#models/user'

export type ReportReason = 'offensive_content' | 'spam' | 'harassment' | 'other'
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'rejected'
export type ReportResourceType = 'user' | 'list' | 'review'
export type ReportPriority = 'low' | 'medium' | 'high' | 'critical'

export default class Report extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignUuid(report: Report) {
    report.id = randomUUID()
  }

  @column()
  declare reporterId: string

  @column()
  declare resourceType: ReportResourceType

  @column()
  declare resourceId: string

  @column()
  declare reason: ReportReason

  @column()
  declare description: string | null

  @column()
  declare status: ReportStatus

  @column()
  declare reviewedBy: string | null

  @column()
  declare moderatorNotes: string | null

  @column()
  declare priority: ReportPriority

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, {
    foreignKey: 'reporterId',
  })
  declare reporter: BelongsTo<typeof User>

  @belongsTo(() => User, {
    foreignKey: 'reviewedBy',
  })
  declare moderator: BelongsTo<typeof User>
}
