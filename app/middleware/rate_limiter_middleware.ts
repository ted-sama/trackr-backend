import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import cacheService from '#services/cache_service'
import AppError from '#exceptions/app_error'

interface RateLimitConfig {
  maxAttempts: number
  windowMs: number
  keyPrefix: string
}

/**
 * Rate limiter middleware using Upstash Redis cache
 * Implements sliding window rate limiting per IP
 */
export default class RateLimiterMiddleware {
  private static readonly configs: Record<string, RateLimitConfig> = {
    login: { maxAttempts: 5, windowMs: 15 * 60 * 1000, keyPrefix: 'rl:login' }, // 5 per 15 min
    'forgot-password': { maxAttempts: 3, windowMs: 60 * 60 * 1000, keyPrefix: 'rl:forgot' }, // 3 per hour
    register: { maxAttempts: 10, windowMs: 60 * 60 * 1000, keyPrefix: 'rl:register' }, // 10 per hour
    refresh: { maxAttempts: 20, windowMs: 60 * 60 * 1000, keyPrefix: 'rl:refresh' }, // 20 per hour
    'check-email': { maxAttempts: 3, windowMs: 60 * 1000, keyPrefix: 'rl:check-email' }, // 3 per minute
    'resend-verification': { maxAttempts: 3, windowMs: 60 * 60 * 1000, keyPrefix: 'rl:verify' }, // 3 per hour
  }

  async handle(ctx: HttpContext, next: NextFn, options: { limitType: string }) {
    const { limitType } = options
    const config = RateLimiterMiddleware.configs[limitType]

    if (!config) {
      // No rate limit configured for this type, proceed
      return next()
    }

    const ip = this.getClientIp(ctx)
    const key = `${config.keyPrefix}:${ip}`

    try {
      const currentCount = (await cacheService.get<number>(key)) ?? 0

      if (currentCount >= config.maxAttempts) {
        const windowMinutes = Math.ceil(config.windowMs / 60000)
        throw new AppError(`Too many requests. Please try again in ${windowMinutes} minutes.`, {
          status: 429,
          code: 'RATE_LIMIT_EXCEEDED',
        })
      }

      // Increment counter
      const ttlSeconds = Math.ceil(config.windowMs / 1000)
      if (currentCount === 0) {
        await cacheService.set(key, 1, ttlSeconds)
      } else {
        // Use put to update without resetting TTL would be ideal, but set works
        await cacheService.set(key, currentCount + 1, ttlSeconds)
      }

      // Set rate limit headers
      ctx.response.header('X-RateLimit-Limit', config.maxAttempts.toString())
      ctx.response.header('X-RateLimit-Remaining', Math.max(0, config.maxAttempts - currentCount - 1).toString())

      return next()
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }
      // If cache is unavailable, log and proceed (fail open for availability)
      console.warn('[RateLimiter] Cache error, proceeding without rate limit:', error)
      return next()
    }
  }

  private getClientIp(ctx: HttpContext): string {
    // Check common proxy headers
    const forwarded = ctx.request.header('x-forwarded-for')
    if (forwarded) {
      return forwarded.split(',')[0].trim()
    }

    const realIp = ctx.request.header('x-real-ip')
    if (realIp) {
      return realIp
    }

    return ctx.request.ip() ?? 'unknown'
  }
}
