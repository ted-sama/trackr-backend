import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText } from 'ai'
import { DateTime } from 'luxon'
import Book from '#models/book'
import BookRecap from '#models/book_recap'
import BookTracking from '#models/book_tracking'

const openrouter = createOpenRouter({
  apiKey: env.get('OPENROUTER_API_KEY'),
})

// Minimum delay in hours before generating a recap
const RECAP_DELAY_HOURS = 3

// Recap cache expiration in days
const RECAP_EXPIRATION_DAYS = 30

interface RecapResponse {
  recap: string | null
  cached: boolean
  availableAt: string | null
}

export default class RecapController {
  /**
   * @summary Generate manga chapter recap
   * @tag Books
   * @description Generates a recap of previous chapters using AI with web search, with caching and delay support
   * @paramPath id - Book ID - @type(number) @required
   * @paramPath chapterId - Chapter number up to which to generate recap - @type(number) @required
   * @paramQuery force - Force regeneration bypassing 3h delay (dev only) - @type(boolean)
   * @responseBody 200 - { recap: string | null, cached: boolean, availableAt: string | null }
   * @responseBody 404 - Book not found
   * @responseBody 500 - Internal server error
   */
  async recap({ params, request, response, auth }: HttpContext) {
    try {
      const { id: bookId, chapterId } = params
      const forceGenerate = request.input('force') === 'true'

      // Authenticate user
      const user = await auth.authenticate()
      if (!user) {
        return response.unauthorized({ message: 'Unauthorized' })
      }

      // Verify book exists
      const book = await Book.query().where('id', bookId).preload('authors').preload('publishers').first()
      if (!book) {
        return response.notFound({ message: 'Book not found' })
      }

      // Convert chapterId to number for validation
      const chapterNumber = Number.parseInt(chapterId)
      if (isNaN(chapterNumber) || chapterNumber <= 0) {
        return response.badRequest({ message: 'Chapter number must be a positive integer' })
      }

      // Step 1: Check cache for existing recap
      const cachedRecap = await BookRecap.query()
        .where('user_id', user.id)
        .where('book_id', bookId)
        .where('chapter', chapterNumber)
        .first()

      if (cachedRecap) {
        // Check if recap has expired
        const isExpired = cachedRecap.expiresAt && DateTime.now() > cachedRecap.expiresAt

        if (isExpired) {
          // Delete expired recap and continue to regenerate
          await cachedRecap.delete()
        } else {
          // Return valid cached recap
          return response.ok({
            recap: cachedRecap.recap,
            cached: true,
            availableAt: null,
          } satisfies RecapResponse)
        }
      }

      // Step 2: Check if 3h delay has passed since lastReadAt (skip if force=true)
      const bookTracking = await BookTracking.query()
        .where('user_id', user.id)
        .where('book_id', bookId)
        .first()

      if (!bookTracking) {
        return response.notFound({ message: 'Book not tracked by user' })
      }

      // If no lastReadAt, consider it as never read - allow recap generation
      // Skip delay check if force=true (dev mode)
      if (!forceGenerate && bookTracking.lastReadAt) {
        const hoursSinceLastRead = DateTime.now().diff(bookTracking.lastReadAt, 'hours').hours

        if (hoursSinceLastRead < RECAP_DELAY_HOURS) {
          const availableAt = bookTracking.lastReadAt.plus({ hours: RECAP_DELAY_HOURS })
          return response.ok({
            recap: null,
            cached: false,
            availableAt: availableAt.toISO(),
          } satisfies RecapResponse)
        }
      }

      // Step 3: Generate recap with Grok via OpenRouter
      const apiKey = env.get('OPENROUTER_API_KEY')
      if (!apiKey) {
        return response.internalServerError({ message: 'AI service not configured' })
      }

      const authorNames = book.authors.map((author) => author.name).join(', ')
      const bookTitle = book.title

      const systemPrompt = `Tu es un expert en résumés de manga/comics.

CONTEXTE: L'utilisateur a lu jusqu'au chapitre ${chapterNumber} de "${bookTitle}"${authorNames ? ` (par ${authorNames})` : ''} et reprend sa lecture après une pause.

OBJECTIF: Fournir un résumé COURT (max 150 mots) qui aide à se replonger dans l'histoire.

FORMAT DU RÉSUMÉ:
1. Rappel bref du contexte global (1-2 phrases max)
2. Ce qui s'est passé au chapitre ${chapterNumber} spécifiquement (focus principal)
3. Où en sont les personnages principaux

RÈGLES:
- Maximum 150 mots
- Pas de spoilers des chapitres suivants
- Ton direct et concis
- En français
- Pas de phrases d'introduction ("Voici le résumé...")
- Utilise la recherche web pour des informations précises sur ce chapitre`

      const userPrompt = `Génère un résumé court pour le chapitre ${chapterNumber} de "${bookTitle}".`

      const result = await generateText({
        model: openrouter('x-ai/grok-4-fast:online'),
        system: systemPrompt,
        prompt: userPrompt,
      })

      const generatedRecap = result.text.trim()

      // Step 4: Save recap to cache with expiration
      await BookRecap.create({
        userId: user.id,
        bookId: bookId,
        chapter: chapterNumber,
        recap: generatedRecap,
        expiresAt: DateTime.now().plus({ days: RECAP_EXPIRATION_DAYS }),
      })

      return response.ok({
        recap: generatedRecap,
        cached: false,
        availableAt: null,
      } satisfies RecapResponse)

    } catch (error) {
      console.error('Recap generation error:', error)
      return response.internalServerError({
        message: 'Failed to generate recap',
        error: error.message,
      })
    }
  }
}
