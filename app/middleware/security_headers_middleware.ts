import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Security headers middleware
 * Adds common security headers to all responses
 */
export default class SecurityHeadersMiddleware {
  async handle({ response }: HttpContext, next: NextFn) {
    // Prevent MIME type sniffing
    response.header('X-Content-Type-Options', 'nosniff')

    // Prevent clickjacking
    response.header('X-Frame-Options', 'DENY')

    // Enable XSS filter in older browsers
    response.header('X-XSS-Protection', '1; mode=block')

    // Enforce HTTPS (only in production)
    if (process.env.NODE_ENV === 'production') {
      response.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }

    // Prevent information leakage
    response.header('Referrer-Policy', 'strict-origin-when-cross-origin')

    // Basic CSP for API
    response.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")

    return next()
  }
}
