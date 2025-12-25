import type { HttpContext } from '@adonisjs/core/http'
import { getAllGenreTranslations, supportedLanguages } from '../data/genre_translations.js'

export default class GenresController {
  /**
   * @summary Get genre translations
   * @tag Genres
   * @description Returns all genre translations for supported languages
   * @responseBody 200 - { translations: Record<string, Record<string, string>>, languages: string[] }
   */
  async translations({ response }: HttpContext) {
    return response.ok({
      translations: getAllGenreTranslations(),
      languages: supportedLanguages,
    })
  }
}
