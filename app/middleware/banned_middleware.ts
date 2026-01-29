import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { DateTime } from 'luxon'

/**
 * Middleware to check if the authenticated user is banned.
 * Returns 403 Forbidden with ban details if user is banned.
 * Auto-unbans users whose temporary ban has expired.
 */
export default class BannedMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user

    // If no user (not authenticated), let other middleware handle it
    if (!user) {
      return next()
    }

    // Check if user is banned
    if (user.isBanned) {
      // Check if temporary ban has expired
      if (user.bannedUntil && DateTime.now() >= user.bannedUntil) {
        // Auto-unban: temporary ban has expired
        user.isBanned = false
        user.bannedUntil = null
        user.banReason = null
        user.bannedBy = null
        user.bannedAt = null
        await user.save()

        // Allow request to proceed
        return next()
      }

      // User is still banned
      const isPermanent = !user.bannedUntil

      return ctx.response.forbidden({
        error: 'Account suspended',
        code: 'ACCOUNT_BANNED',
        details: {
          isPermanent,
          reason: user.banReason || 'Violation of community guidelines',
          bannedAt: user.bannedAt?.toISO(),
          bannedUntil: user.bannedUntil?.toISO() || null,
          timeRemaining: user.banTimeRemaining,
          message: isPermanent
            ? 'Your account has been permanently suspended.'
            : `Your account is suspended until ${user.bannedUntil?.toLocaleString(DateTime.DATETIME_MED)}.`,
        },
      })
    }

    return next()
  }
}
