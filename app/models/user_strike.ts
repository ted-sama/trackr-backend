import { DateTime } from 'luxon'
import { BaseModel, column, beforeCreate, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import User from '#models/user'
import Report from '#models/report'
import ModeratedContent from '#models/moderated_content'

export type StrikeReason = 'profanity' | 'hate_speech' | 'spam' | 'harassment' | 'other'
export type StrikeSeverity = 'minor' | 'moderate' | 'severe'

export default class UserStrike extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignUuid(strike: UserStrike) {
    strike.id = randomUUID()
  }

  @column()
  declare userId: string

  @column()
  declare reason: StrikeReason

  @column()
  declare severity: StrikeSeverity

  @column()
  declare issuedBy: string | null

  @column()
  declare reportId: string | null

  @column()
  declare moderatedContentId: string | null

  @column()
  declare notes: string | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // Relations
  @belongsTo(() => User, {
    foreignKey: 'userId',
  })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, {
    foreignKey: 'issuedBy',
  })
  declare issuer: BelongsTo<typeof User>

  @belongsTo(() => Report, {
    foreignKey: 'reportId',
  })
  declare report: BelongsTo<typeof Report>

  @belongsTo(() => ModeratedContent, {
    foreignKey: 'moderatedContentId',
  })
  declare moderatedContent: BelongsTo<typeof ModeratedContent>

  /**
   * Check if the strike is still active (not expired)
   */
  get isActive(): boolean {
    if (!this.expiresAt) {
      return true // Never expires
    }
    return DateTime.now() < this.expiresAt
  }

  /**
   * Get severity weight for auto-escalation calculations
   */
  get severityWeight(): number {
    switch (this.severity) {
      case 'minor':
        return 1
      case 'moderate':
        return 2
      case 'severe':
        return 3
      default:
        return 1
    }
  }
}
