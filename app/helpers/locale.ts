import type { HttpContext } from '@adonisjs/core/http'

const SUPPORTED_LOCALES = ['en', 'fr'] as const
const DEFAULT_LOCALE = 'en'

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/**
 * Detects the user's preferred language from the Accept-Language header
 * Falls back to 'en' if no supported language is found
 */
export function detectLocale(request: HttpContext['request']): SupportedLocale {
  const acceptLanguage = request.header('Accept-Language') || ''

  // Parse Accept-Language header (e.g., "fr-FR,fr;q=0.9,en;q=0.8")
  const languages = acceptLanguage
    .split(',')
    .map((lang) => {
      const [code, priority] = lang.trim().split(';q=')
      return {
        code: code.split('-')[0].toLowerCase(), // Get base language code (fr from fr-FR)
        priority: priority ? parseFloat(priority) : 1,
      }
    })
    .sort((a, b) => b.priority - a.priority)

  // Find first supported language
  for (const lang of languages) {
    if (SUPPORTED_LOCALES.includes(lang.code as SupportedLocale)) {
      return lang.code as SupportedLocale
    }
  }

  return DEFAULT_LOCALE
}

/**
 * Returns the email template path for the given template and locale
 */
export function getEmailTemplate(template: string, locale: SupportedLocale): string {
  return `emails/${locale}/${template}`
}
