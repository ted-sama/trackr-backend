/*
|--------------------------------------------------------------------------
| Sentry Helper
|--------------------------------------------------------------------------
|
| Helper functions for manual Sentry instrumentation in services and
| other parts of the application.
|
*/

import * as Sentry from '@sentry/node'

/**
 * Wrap an async operation in a Sentry span for performance monitoring.
 * Automatically captures errors and records timing.
 *
 * @example
 * const result = await withSpan('gemini.generate', async (span) => {
 *   span.setAttribute('model', 'gemini-pro')
 *   return await gemini.generateContent(prompt)
 * })
 */
export async function withSpan<T>(
  name: string,
  operation: (span: Sentry.Span) => Promise<T>,
  options?: {
    op?: string
    description?: string
    attributes?: Record<string, string | number | boolean>
  }
): Promise<T> {
  return Sentry.startSpan(
    {
      name,
      op: options?.op || 'function',
      attributes: options?.attributes,
    },
    async (span) => {
      try {
        const result = await operation(span)
        span.setStatus({ code: 1, message: 'ok' })
        return result
      } catch (error) {
        span.setStatus({ code: 2, message: 'error' })
        throw error
      }
    }
  )
}

/**
 * Wrap a database operation in a Sentry span.
 *
 * @example
 * const books = await withDbSpan('books.findAll', async () => {
 *   return await Book.query().where('status', 'published')
 * })
 */
export async function withDbSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return withSpan(name, operation, { op: 'db.query' })
}

/**
 * Wrap an external HTTP call in a Sentry span.
 *
 * @example
 * const data = await withHttpSpan('google-books-api', async () => {
 *   return await axios.get('https://books.googleapis.com/...')
 * })
 */
export async function withHttpSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return withSpan(name, operation, { op: 'http.client' })
}

/**
 * Wrap an AI/LLM operation in a Sentry span.
 *
 * @example
 * const response = await withAiSpan('gemini.chat', async (span) => {
 *   span.setAttribute('model', 'gemini-2.0-flash')
 *   span.setAttribute('tokens', 1000)
 *   return await gemini.chat(messages)
 * })
 */
export async function withAiSpan<T>(
  name: string,
  operation: (span: Sentry.Span) => Promise<T>
): Promise<T> {
  return withSpan(name, operation, { op: 'ai.inference' })
}

/**
 * Wrap a file/storage operation in a Sentry span.
 *
 * @example
 * const url = await withStorageSpan('s3.upload', async () => {
 *   return await drive.put(path, content)
 * })
 */
export async function withStorageSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return withSpan(name, operation, { op: 'file.io' })
}

/**
 * Add a breadcrumb to track user actions or important events.
 *
 * @example
 * addBreadcrumb('user.login', { userId: user.id, method: 'email' })
 */
export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  category?: string,
  level?: Sentry.SeverityLevel
): void {
  Sentry.addBreadcrumb({
    message,
    category: category || 'app',
    level: level || 'info',
    data,
  })
}

/**
 * Set user context for all subsequent Sentry events.
 *
 * @example
 * setUser({ id: user.id, email: user.email })
 */
export function setUser(user: { id: string; email?: string; username?: string } | null): void {
  Sentry.setUser(user)
}

/**
 * Capture a message with optional level and context.
 *
 * @example
 * captureMessage('Payment processed', 'info', { orderId: '123', amount: 99.99 })
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>
): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context)
      Sentry.captureMessage(message, level)
    })
  } else {
    Sentry.captureMessage(message, level)
  }
}

/**
 * Capture an exception with optional context.
 *
 * @example
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   captureException(error, { operation: 'risky', userId: user.id })
 * }
 */
export function captureException(error: Error, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context)
      Sentry.captureException(error)
    })
  } else {
    Sentry.captureException(error)
  }
}

// Re-export Sentry for advanced usage
export { Sentry }
