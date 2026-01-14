import { Redis } from '@upstash/redis'
import env from '#start/env'

/**
 * Service for interacting with Upstash Redis cache
 * Used for rate limiting, cooldowns, and general caching
 */
class CacheService {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      url: env.get('UPSTASH_REDIS_REST_URL'),
      token: env.get('UPSTASH_REDIS_REST_TOKEN'),
    })
  }

  /**
   * Set a key with optional TTL (in seconds)
   */
  async set(key: string, value: string | number | boolean, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, { ex: ttlSeconds })
    } else {
      await this.redis.set(key, value)
    }
  }

  /**
   * Get a value by key
   */
  async get<T = string>(key: string): Promise<T | null> {
    return this.redis.get<T>(key)
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    await this.redis.del(key)
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key)
    return result === 1
  }

  /**
   * Set a key only if it doesn't exist (useful for locks/cooldowns)
   * Returns true if the key was set, false if it already existed
   */
  async setIfNotExists(
    key: string,
    value: string | number | boolean,
    ttlSeconds: number
  ): Promise<boolean> {
    const result = await this.redis.set(key, value, { ex: ttlSeconds, nx: true })
    return result === 'OK'
  }

  /**
   * Get remaining TTL for a key (in seconds)
   * Returns -2 if key doesn't exist, -1 if no TTL
   */
  async getTtl(key: string): Promise<number> {
    return this.redis.ttl(key)
  }
}

export default new CacheService()
