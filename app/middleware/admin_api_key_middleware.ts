import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'

/**
 * Admin API Key Middleware
 *
 * Validates API key from X-Admin-API-Key header against
 * ADMIN_API_KEY_TED and ADMIN_API_KEY_ZANGO environment variables.
 * Adds adminKeyOwner to the HTTP context for audit logging.
 */
export default class AdminApiKeyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const apiKey = ctx.request.header('X-Admin-API-Key')

    if (!apiKey) {
      return ctx.response.unauthorized({
        error: 'Missing API key',
        message: 'X-Admin-API-Key header is required',
      })
    }

    const tedKey = env.get('ADMIN_API_KEY_TED')
    const zangoKey = env.get('ADMIN_API_KEY_ZANGO')

    let owner: 'ted' | 'zango' | null = null

    if (tedKey && apiKey === tedKey) {
      owner = 'ted'
    } else if (zangoKey && apiKey === zangoKey) {
      owner = 'zango'
    }

    if (!owner) {
      return ctx.response.unauthorized({
        error: 'Invalid API key',
        message: 'The provided API key is not valid',
      })
    }

    // Add owner to context for audit logging
    ctx.adminKeyOwner = owner

    return next()
  }
}

// Extend HttpContext to include adminKeyOwner
declare module '@adonisjs/core/http' {
  interface HttpContext {
    adminKeyOwner?: 'ted' | 'zango'
  }
}
