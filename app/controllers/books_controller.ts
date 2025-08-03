import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import db from '@adonisjs/lucid/services/db'
import { aiTranslate } from '../helpers/ai_translate.js'

export default class BooksController {
  /**
   * @summary Get list of books
   * @tag Books
   * @description Returns a paginated list of books with optional filtering
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 100) - @type(number)
   * @responseBody 200 - <Book[]>.paginated() - List of books with pagination
   * @responseBody 400 - Bad request
   */
  async index({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)

    const books = await Book.query().paginate(page, limit)
    return response.ok(books)
  }

  /**
   * @summary Get book by ID
   * @tag Books
   * @description Returns a single book by its ID with all related data
   * @paramPath id - Book ID - @type(number) @required
   * @responseBody 200 - <Book>.with(categories, chapterList, lists, bookTrackings) - Book details
   * @responseBody 404 - Book not found
   */
  async show({ params, response }: HttpContext) {
    const book = await Book.find(params.id)
    if (!book) {
      return response.notFound({ message: 'Book not found' })
    }

    // Translate the book's description to fr if not present in db
    if (!book.descriptionFr && book.description) {
      book.descriptionFr = await aiTranslate(book.description, 'fr')
      await book.save()
    }

    return response.ok(book)
  }

  async search({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const query = request.input('q')

    if (!query) {
      return response.badRequest({ message: 'Search query is required' })
    }

    const normalizedQuery = query.trim().toLowerCase()

    const books = await Book.query()
      .select('*')
      .select(
        db.raw(
          `
        CASE 
          WHEN LOWER(title) = ? THEN 100
          WHEN LOWER(title) LIKE ? THEN 90
          WHEN EXISTS (
            SELECT 1 FROM unnest(alternative_titles) AS alt_title 
            WHERE LOWER(alt_title) = ?
          ) THEN 85
          WHEN EXISTS (
            SELECT 1 FROM unnest(alternative_titles) AS alt_title 
            WHERE LOWER(alt_title) LIKE ?
          ) THEN 80
          WHEN LOWER(author) LIKE ? THEN 70
          WHEN search_text ILIKE ? THEN 60
          ELSE 50
        END as relevance_score
      `,
          [
            normalizedQuery,
            `${normalizedQuery}%`,
            normalizedQuery,
            `${normalizedQuery}%`,
            `%${normalizedQuery}%`,
            `%${normalizedQuery}%`,
          ]
        )
      )
      .where((searchQuery) => {
        searchQuery
          .whereRaw('LOWER(title) = ?', [normalizedQuery])
          .orWhereILike('title', `%${normalizedQuery}%`)
          .orWhereRaw(
            'EXISTS (SELECT 1 FROM unnest(alternative_titles) AS alt_title WHERE LOWER(alt_title) = ?)',
            [normalizedQuery]
          )
          .orWhereRaw(
            'EXISTS (SELECT 1 FROM unnest(alternative_titles) AS alt_title WHERE LOWER(alt_title) LIKE ?)',
            [`%${normalizedQuery}%`]
          )
          .orWhereILike('author', `%${normalizedQuery}%`)
          .orWhereILike('search_text', `%${normalizedQuery}%`)
      })
      .orderBy('relevance_score', 'desc')
      .orderBy('rating_count', 'desc')
      .orderBy('rating', 'desc')
      .paginate(page, limit)

    return response.ok(books)
  }
}
