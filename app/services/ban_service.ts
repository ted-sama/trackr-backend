import { DateTime } from 'luxon'
import User from '#models/user'
import UserStrike from '#models/user_strike'
import type { StrikeReason, StrikeSeverity } from '#models/user_strike'
import moderationConfig from '#config/moderation'

export interface StrikeOptions {
  issuedBy?: string | null
  reportId?: string | null
  moderatedContentId?: string | null
  notes?: string | null
}

export interface BanResult {
  success: boolean
  action: 'warning' | 'temp_ban' | 'perm_ban' | 'none'
  message: string
  strikeCount: number
  banUntil?: DateTime | null
}

export interface BanStatus {
  isBanned: boolean
  isPermanent: boolean
  banReason: string | null
  bannedUntil: DateTime | null
  banTimeRemaining: string | null
  strikeCount: number
}

export default class BanService {
  /**
   * Add a strike to a user and auto-escalate if necessary
   */
  static async addStrike(
    userId: string,
    reason: StrikeReason,
    severity: StrikeSeverity,
    options: StrikeOptions = {}
  ): Promise<BanResult> {
    const user = await User.findOrFail(userId)

    // Calculate strike expiration
    const expiresAt = moderationConfig.strikes.strikeExpirationDays
      ? DateTime.now().plus({ days: moderationConfig.strikes.strikeExpirationDays })
      : null

    // Create the strike
    await UserStrike.create({
      userId,
      reason,
      severity,
      issuedBy: options.issuedBy ?? null,
      reportId: options.reportId ?? null,
      moderatedContentId: options.moderatedContentId ?? null,
      notes: options.notes ?? null,
      expiresAt,
    })

    // Update user's strike count
    user.strikeCount = (user.strikeCount || 0) + 1
    user.lastStrikeAt = DateTime.now()
    await user.save()

    // Determine action based on strike count
    return await this.evaluateAndApplyAction(user)
  }

  /**
   * Evaluate user's strike count and apply appropriate action
   */
  private static async evaluateAndApplyAction(user: User): Promise<BanResult> {
    const { strikes } = moderationConfig
    const strikeCount = user.strikeCount

    // Check for permanent ban threshold
    if (strikeCount >= strikes.permaBanThreshold) {
      await this.permaBan(user.id, 'Automatic: exceeded strike limit', null)
      return {
        success: true,
        action: 'perm_ban',
        message: `User permanently banned after ${strikeCount} strikes`,
        strikeCount,
        banUntil: null,
      }
    }

    // Check for temporary ban threshold
    if (strikeCount >= strikes.tempBanThreshold) {
      // Calculate which temp ban duration to use
      const tempBanIndex = Math.min(
        strikeCount - strikes.tempBanThreshold,
        strikes.tempBanDurations.length - 1
      )
      const banDays = strikes.tempBanDurations[tempBanIndex]

      const banUntil = await this.tempBan(
        user.id,
        banDays,
        `Automatic: ${strikeCount} strikes accumulated`,
        null
      )

      return {
        success: true,
        action: 'temp_ban',
        message: `User temporarily banned for ${banDays} days after ${strikeCount} strikes`,
        strikeCount,
        banUntil,
      }
    }

    // Warning only
    if (strikeCount >= strikes.warningThreshold) {
      return {
        success: true,
        action: 'warning',
        message: `Warning issued. User has ${strikeCount} strike(s). ${strikes.tempBanThreshold - strikeCount} more until temporary ban.`,
        strikeCount,
      }
    }

    return {
      success: true,
      action: 'none',
      message: 'Strike recorded',
      strikeCount,
    }
  }

  /**
   * Apply a temporary ban to a user
   */
  static async tempBan(
    userId: string,
    durationDays: number,
    reason: string,
    bannedBy: string | null
  ): Promise<DateTime> {
    const user = await User.findOrFail(userId)

    const bannedUntil = DateTime.now().plus({ days: durationDays })

    user.isBanned = true
    user.bannedUntil = bannedUntil
    user.banReason = reason
    user.bannedBy = bannedBy
    user.bannedAt = DateTime.now()

    await user.save()

    return bannedUntil
  }

  /**
   * Apply a permanent ban to a user
   */
  static async permaBan(userId: string, reason: string, bannedBy: string | null): Promise<void> {
    const user = await User.findOrFail(userId)

    user.isBanned = true
    user.bannedUntil = null // null = permanent
    user.banReason = reason
    user.bannedBy = bannedBy
    user.bannedAt = DateTime.now()

    await user.save()
  }

  /**
   * Remove ban from a user
   */
  static async unban(userId: string): Promise<void> {
    const user = await User.findOrFail(userId)

    user.isBanned = false
    user.bannedUntil = null
    user.banReason = null
    user.bannedBy = null
    user.bannedAt = null

    await user.save()
  }

  /**
   * Check ban status of a user
   */
  static async checkBanStatus(userId: string): Promise<BanStatus> {
    const user = await User.findOrFail(userId)

    // Auto-unban if temp ban has expired
    if (user.isBanned && user.bannedUntil && DateTime.now() >= user.bannedUntil) {
      await this.unban(userId)
      return {
        isBanned: false,
        isPermanent: false,
        banReason: null,
        bannedUntil: null,
        banTimeRemaining: null,
        strikeCount: user.strikeCount,
      }
    }

    return {
      isBanned: user.isBanned,
      isPermanent: user.isBanned && !user.bannedUntil,
      banReason: user.banReason,
      bannedUntil: user.bannedUntil,
      banTimeRemaining: user.banTimeRemaining,
      strikeCount: user.strikeCount,
    }
  }

  /**
   * Get active strikes for a user (not expired)
   */
  static async getActiveStrikes(userId: string): Promise<UserStrike[]> {
    return await UserStrike.query()
      .where('user_id', userId)
      .where((query) => {
        query.whereNull('expires_at').orWhere('expires_at', '>', DateTime.now().toSQL()!)
      })
      .orderBy('created_at', 'desc')
  }

  /**
   * Get all strikes for a user (including expired)
   */
  static async getAllStrikes(userId: string): Promise<UserStrike[]> {
    return await UserStrike.query()
      .where('user_id', userId)
      .preload('issuer')
      .preload('report')
      .orderBy('created_at', 'desc')
  }

  /**
   * Recalculate user's active strike count
   * Useful after strikes expire
   */
  static async recalculateStrikeCount(userId: string): Promise<number> {
    const user = await User.findOrFail(userId)
    const activeStrikes = await this.getActiveStrikes(userId)

    user.strikeCount = activeStrikes.length
    await user.save()

    return activeStrikes.length
  }

  /**
   * Remove a specific strike (admin action)
   */
  static async removeStrike(strikeId: string, userId: string): Promise<void> {
    const strike = await UserStrike.query()
      .where('id', strikeId)
      .where('user_id', userId)
      .firstOrFail()

    await strike.delete()

    // Recalculate strike count
    await this.recalculateStrikeCount(userId)
  }

  /**
   * Clear all strikes for a user (admin action)
   */
  static async clearAllStrikes(userId: string): Promise<void> {
    await UserStrike.query().where('user_id', userId).delete()

    const user = await User.findOrFail(userId)
    user.strikeCount = 0
    user.lastStrikeAt = null
    await user.save()
  }
}
