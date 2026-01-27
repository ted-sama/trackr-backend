/*
|--------------------------------------------------------------------------
| Sentry Instrumentation
|--------------------------------------------------------------------------
|
| This file initializes Sentry for error tracking and performance monitoring.
| It MUST be imported before any other modules to ensure proper instrumentation.
|
*/

import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'

const dsn = process.env.SENTRY_DSN
const isProduction = process.env.NODE_ENV === 'production'

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,

    // Performance monitoring - adjust sample rates for production
    tracesSampleRate: isProduction ? 0.2 : 1.0,

    // Profiling sample rate (relative to tracesSampleRate)
    profilesSampleRate: isProduction ? 0.2 : 1.0,

    enableLogs: true,
    integrations: [
      // CPU profiling for performance insights
      nodeProfilingIntegration(),

      // Capture console.error and console.warn as breadcrumbs
      Sentry.captureConsoleIntegration({
        levels: ['error', 'warn', 'log'],
      }),

      // Automatically instrument PostgreSQL queries
      Sentry.postgresIntegration(),

      // HTTP request tracing
      Sentry.httpIntegration(),

      // Add breadcrumbs for console logs
      Sentry.consoleIntegration(),
    ],

    // Attach stack traces to all messages
    attachStacktrace: true,

    // Send default PII (be careful in production)
    sendDefaultPii: false,

    // Filter out sensitive data
    beforeSend(event) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization']
        delete event.request.headers['cookie']
        delete event.request.headers['x-api-key']
      }

      // Remove sensitive data from request body
      if (event.request?.data && typeof event.request.data === 'object') {
        const sensitiveFields = [
          'password',
          'currentPassword',
          'newPassword',
          'token',
          'refreshToken',
          'accessToken',
          'secret',
          'apiKey',
          'api_key',
          'creditCard',
          'cvv',
        ]
        const data = event.request.data as Record<string, unknown>
        for (const field of sensitiveFields) {
          if (field in data) {
            data[field] = '[REDACTED]'
          }
        }
      }

      return event
    },

    // Filter breadcrumbs to avoid noise
    beforeBreadcrumb(breadcrumb) {
      // Filter out noisy breadcrumbs
      if (breadcrumb.category === 'http') {
        // Ignore health check endpoints
        if (breadcrumb.data?.url?.includes('/health')) {
          return null
        }
      }

      // Redact sensitive URLs
      if (breadcrumb.data?.url) {
        const url = breadcrumb.data.url as string
        if (url.includes('password') || url.includes('token')) {
          breadcrumb.data.url = '[REDACTED]'
        }
      }

      return breadcrumb
    },

    // Ignore specific errors that are expected
    ignoreErrors: [
      // Authentication errors (expected behavior)
      'E_UNAUTHORIZED_ACCESS',
      'E_INVALID_CREDENTIALS',
      'E_INVALID_TOKEN',
      // Validation errors (expected behavior)
      'E_VALIDATION_FAILURE',
      'E_VALIDATION_ERROR',
      // Rate limiting
      'E_TOO_MANY_REQUESTS',
      // Not found (expected)
      'E_ROW_NOT_FOUND',
    ],

    // Filter transactions
    tracesSampler: (samplingContext) => {
      const transactionName = samplingContext.name

      // Always sample error transactions
      if (samplingContext.parentSampled) {
        return true
      }

      // Don't sample health checks
      if (transactionName?.includes('/health')) {
        return 0
      }

      // Don't sample static assets
      if (transactionName?.match(/\.(js|css|png|jpg|ico|svg)$/)) {
        return 0
      }

      // Sample other transactions based on environment
      return isProduction ? 0.2 : 1.0
    },
  })

  // Log Sentry initialization
  console.log(`[Sentry] Initialized for ${process.env.NODE_ENV || 'development'} environment`)
}

export { Sentry }
