import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import { createHash, randomBytes } from 'node:crypto'

export default class RefreshToken extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: string

  @column()
  declare tokenHash: string

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime()
  declare revokedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  /**
   * Check if the token is valid (not expired and not revoked)
   */
  get isValid(): boolean {
    if (this.revokedAt) return false
    return DateTime.now() < this.expiresAt
  }

  /**
   * Generate a new refresh token for a user
   * Returns both the raw token (to send to client) and the model (to save)
   */
  static async generateForUser(
    user: User,
    expiresInDays: number = 90
  ): Promise<{ rawToken: string; refreshToken: RefreshToken }> {
    // Generate a random token
    const rawToken = randomBytes(32).toString('hex')

    // Hash it for storage
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    // Create the refresh token record
    const refreshToken = await RefreshToken.create({
      userId: user.id,
      tokenHash,
      expiresAt: DateTime.now().plus({ days: expiresInDays }),
    })

    return { rawToken, refreshToken }
  }

  /**
   * Find a valid refresh token by its raw value
   */
  static async findByToken(rawToken: string): Promise<RefreshToken | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')

    const refreshToken = await RefreshToken.query()
      .where('token_hash', tokenHash)
      .whereNull('revoked_at')
      .where('expires_at', '>', DateTime.now().toSQL()!)
      .first()

    return refreshToken
  }

  /**
   * Revoke this refresh token
   */
  async revoke(): Promise<void> {
    this.revokedAt = DateTime.now()
    await this.save()
  }

  /**
   * Revoke all refresh tokens for a user
   */
  static async revokeAllForUser(userId: string): Promise<void> {
    await RefreshToken.query()
      .where('user_id', userId)
      .whereNull('revoked_at')
      .update({ revokedAt: DateTime.now().toSQL() })
  }

  /**
   * Clean up expired tokens (can be run periodically)
   */
  static async cleanupExpired(): Promise<number> {
    const deleted = await RefreshToken.query()
      .where('expires_at', '<', DateTime.now().toSQL()!)
      .delete()

    return deleted.length
  }
}
