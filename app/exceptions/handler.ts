import * as Sentry from '@sentry/node'
import app from '@adonisjs/core/services/app'
import { HttpContext, ExceptionHandler } from '@adonisjs/core/http'

type ValidationIssue = {
  field?: string
  message: string
  rule?: string
}

type ValidationMessages = ValidationIssue[] | { errors: ValidationIssue[] }

type ValidationError = {
  status?: number
  messages: ValidationMessages
}

type HttpErrorLike = {
  status?: number
  statusCode?: number
  code?: string
  message?: string
  meta?: Record<string, unknown>
}

type NormalizedError = {
  status: number
  code: string
  message: string
  details?: ValidationIssue[] | unknown
}

const FALLBACKS: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'Bad request' },
  401: { code: 'AUTH_UNAUTHENTICATED', message: 'Authentication required' },
  403: { code: 'AUTH_FORBIDDEN', message: 'You are not allowed to perform this action' },
  404: { code: 'RESOURCE_NOT_FOUND', message: 'Resource not found' },
  409: { code: 'CONFLICT', message: 'Resource conflict' },
  422: { code: 'VALIDATION_ERROR', message: 'Validation failed' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests' },
  500: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
}

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    const normalized = this.normalizeError(error)

    const payload = { error: normalized }

    ctx.response.header('Content-Type', 'application/json')
    return ctx.response.status(normalized.status).json(payload)
  }

  /**
   * The method is used to report error to the logging service or
   * the third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    const status = this.resolveStatus(error)
    const errorCode = this.extractCode(error)

    // Log server errors
    if (ctx && status >= 500) {
      ctx.logger.error({ err: error }, 'Unhandled server error')
    }

    // Send to Sentry (only for server errors, not client errors)
    if (status >= 500) {
      Sentry.withScope((scope) => {
        // Set error level based on status
        scope.setLevel(status >= 500 ? 'error' : 'warning')

        // Add error code as tag for filtering
        if (errorCode) {
          scope.setTag('error_code', errorCode)
        }
        scope.setTag('http_status', String(status))

        // Add request context
        if (ctx) {
          // Set transaction name
          scope.setTransactionName(
            `${ctx.request.method()} ${ctx.route?.pattern || ctx.request.url()}`
          )

          // Request details
          scope.setContext('request', {
            url: ctx.request.url(),
            method: ctx.request.method(),
            params: ctx.request.params(),
            query: ctx.request.qs(),
            headers: {
              'user-agent': ctx.request.header('user-agent'),
              'content-type': ctx.request.header('content-type'),
              'accept': ctx.request.header('accept'),
            },
          })

          // Route information
          if (ctx.route) {
            scope.setContext('route', {
              pattern: ctx.route.pattern,
              name: ctx.route.name,
            })
          }

          // Add user context if authenticated
          if (ctx.auth?.user) {
            scope.setUser({
              id: String(ctx.auth.user.id),
              email: ctx.auth.user.email,
              username: ctx.auth.user.username,
            })
          }

          // Add request ID for tracing
          const requestId = ctx.request.header('x-request-id')
          if (requestId) {
            scope.setTag('request_id', requestId)
          }

          // Add breadcrumb for the request
          Sentry.addBreadcrumb({
            category: 'http',
            message: `${ctx.request.method()} ${ctx.request.url()}`,
            level: 'info',
            data: {
              status_code: status,
              method: ctx.request.method(),
              url: ctx.request.url(),
            },
          })
        }

        // Capture the exception with full context
        if (error instanceof Error) {
          Sentry.captureException(error)
        } else {
          Sentry.captureMessage(String(error), 'error')
        }
      })
    }

    return super.report(error, ctx)
  }

  private normalizeError(error: unknown): NormalizedError {
    if (this.isValidationError(error)) {
      return {
        status: 422,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: this.formatValidationIssues(error),
      }
    }

    const status = this.resolveStatus(error)
    const fallback = this.fallbackForStatus(status)

    const code = this.extractCode(error) ?? fallback.code
    const message = this.resolveMessage(error, status, fallback.message)

    const normalized: NormalizedError = {
      status,
      code,
      message,
    }

    return normalized
  }

  private resolveStatus(error: unknown): number {
    if (typeof error === 'object' && error) {
      const httpError = error as HttpErrorLike
      if (typeof httpError.status === 'number') {
        return httpError.status
      }
      if (typeof httpError.statusCode === 'number') {
        return httpError.statusCode
      }
    }

    return 500
  }

  private fallbackForStatus(status: number) {
    if (FALLBACKS[status]) {
      return FALLBACKS[status]
    }

    if (status >= 400 && status < 500) {
      return { code: 'CLIENT_ERROR', message: 'Request cannot be processed' }
    }

    return FALLBACKS[500]
  }

  private extractCode(error: unknown): string | undefined {
    if (typeof error === 'object' && error) {
      const httpError = error as HttpErrorLike
      if (typeof httpError.code === 'string') {
        return httpError.code
      }
    }

    return undefined
  }

  private resolveMessage(error: unknown, status: number, fallback: string): string {
    if (status >= 500 && !this.debug) {
      return fallback
    }

    if (typeof error === 'object' && error) {
      const httpError = error as HttpErrorLike
      if (httpError.message) {
        return httpError.message
      }
    }

    if (error instanceof Error && error.message) {
      return error.message
    }

    return fallback
  }

  private isValidationError(error: unknown): error is ValidationError {
    if (typeof error !== 'object' || error === null || !('messages' in error)) {
      return false
    }

    const messages = (error as ValidationError).messages

    if (Array.isArray(messages)) {
      return true
    }

    return (
      typeof messages === 'object' &&
      messages !== null &&
      'errors' in messages &&
      Array.isArray((messages as { errors: ValidationIssue[] }).errors)
    )
  }

  private formatValidationIssues(error: ValidationError): ValidationIssue[] {
    const messages = error.messages

    if (Array.isArray(messages)) {
      return messages.map((issue) => ({
        field: issue.field,
        rule: issue.rule,
        message: issue.message,
      }))
    }

    if (
      typeof messages === 'object' &&
      messages !== null &&
      'errors' in messages &&
      Array.isArray((messages as { errors: ValidationIssue[] }).errors)
    ) {
      return (messages as { errors: ValidationIssue[] }).errors.map((issue) => ({
        field: issue.field,
        rule: issue.rule,
        message: issue.message,
      }))
    }

    return []
  }
}
