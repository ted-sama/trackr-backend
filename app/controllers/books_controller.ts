import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import AppError from '#exceptions/app_error'
import db from '@adonisjs/lucid/services/db'
import { aiTranslate } from '#helpers/ai_translate'

export default class BooksController {
  /**
   * @summary Get list of books
   * @tag Books
   * @description Returns a paginated list of books with optional filtering
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 100) - @type(number)
   * @paramQuery sort - Sorting method - @type(string) @enum(top_rated, most_listed, most_tracked)
   * @responseBody 200 - <Book[]>.paginated() - List of books with pagination
   * @responseBody 400 - Bad request
   */
  async index({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const sort = request.input('sort') as 'top_rated' | 'most_listed' | 'most_tracked' | undefined
    const nsfw = request.input('nsfw', false)

    const query = Book.query().preload('authors').select('*').where('nsfw', nsfw)

    switch (sort) {
      case 'top_rated': {
        query.whereNotNull('rating').orderBy('rating', 'desc').orderBy('rating_count', 'desc')
        break
      }
      case 'most_listed': {
        query
          .select(
            db.raw(
              `COALESCE((
                SELECT COUNT(*)::int
                FROM list_books lb
                JOIN lists l ON l.id = lb.list_id
                WHERE lb.book_id = books.id
                  AND l.is_public = true
                  AND l.is_my_library = false
              ), 0) AS public_lists_count`
            )
          )
          .orderBy('public_lists_count', 'desc')
          .orderBy('rating_count', 'desc')
          .orderBy('rating', 'desc')
        break
      }
      case 'most_tracked': {
        query
          .select(
            db.raw(
              `COALESCE((
                SELECT COUNT(*)::int
                FROM book_tracking bt
                WHERE bt.book_id = books.id
              ), 0) AS tracking_count`
            )
          )
          .orderBy('tracking_count', 'desc')
          .orderBy('rating_count', 'desc')
          .orderBy('rating', 'desc')
        break
      }
      default: {
        // Default ordering: newest first
        query.orderBy('created_at', 'desc')
      }
    }

    const books = await query.paginate(page, limit)
    return response.ok(books)
  }

  /**
   * @summary Get book by ID
   * @tag Books
   * @description Returns a single book by its ID with all related data
   * @paramPath id - Book ID - @type(number) @required
   * @responseBody 200 - <Book>.with(categories, chapterList, lists, bookTrackings) - Book details
   * @responseBody 404 - {"code": "BOOK_NOT_FOUND", "message": "Book not found"} - Book not found
   */
  async show({ params, response }: HttpContext) {
    const book = await Book.query().where('id', params.id).preload('authors').first()
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
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
    const nsfw = request.input('nsfw', false)

    if (!query) {
      throw new AppError('Search query is required', {
        status: 400,
        code: 'BOOK_SEARCH_QUERY_REQUIRED',
      })
    }

    const normalizedQuery = query.trim().toLowerCase()

    // Utiliser une CTE (Common Table Expression) pour calculer le score de pertinence une seule fois
    const searchResults = await db
      .from('books')
      .where('nsfw', nsfw)
      .select('books.*')
      .select(
        db.raw(
          `
        CASE 
          WHEN LOWER(title) = ? THEN 100
          WHEN LOWER(title) LIKE ? THEN 90
          WHEN search_text ILIKE ? AND LOWER(title) != ? THEN 80
          WHEN EXISTS (
            SELECT 1 FROM author_books ab
            JOIN authors a ON a.id = ab.author_id
            WHERE ab.book_id = books.id
              AND a.name ILIKE ?
          ) THEN 70
          ELSE 50
        END as relevance_score
      `,
          [
            normalizedQuery,
            `${normalizedQuery}%`,
            `%${normalizedQuery}%`,
            normalizedQuery,
            `%${normalizedQuery}%`,
          ]
        )
      )
      .where((searchQuery) => {
        searchQuery
          .whereRaw('LOWER(title) = ?', [normalizedQuery])
          .orWhereILike('title', `%${normalizedQuery}%`)
          .orWhereILike('search_text', `%${normalizedQuery}%`)
          .orWhereExists((existsQuery) => {
            existsQuery
              .from('author_books as ab')
              .innerJoin('authors as a', 'a.id', 'ab.author_id')
              .whereRaw('ab.book_id = books.id')
              .whereILike('a.name', `%${normalizedQuery}%`)
          })
      })
      .orderByRaw('relevance_score DESC, rating_count DESC NULLS LAST, rating DESC NULLS LAST')
      .paginate(page, limit)

    // Charger les auteurs pour tous les livres retournés
    const bookIds = searchResults.map((book) => book.id)
    if (bookIds.length > 0) {
      const authorsData = await db
        .from('authors')
        .innerJoin('author_books', 'author_books.author_id', 'authors.id')
        .whereIn('author_books.book_id', bookIds)
        .select('authors.*', 'author_books.book_id')

      // Grouper les auteurs par book_id
      const authorsByBookId = authorsData.reduce(
        (acc, author) => {
          if (!acc[author.book_id]) {
            acc[author.book_id] = []
          }
          acc[author.book_id].push(author)
          return acc
        },
        {} as Record<number, any[]>
      )

      // Ajouter les auteurs à chaque livre
      searchResults.forEach((book) => {
        book.authors = authorsByBookId[book.id] || []
      })
    }

    return response.ok(searchResults)
  }

  async getBySameAuthor({ params, request, response }: HttpContext) {
    const nsfw = request.input('nsfw', false)

    const book = await Book.find(params.id)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    await book.load('authors')
    const authorIds = book.authors.map((author) => author.id)

    if (authorIds.length === 0) {
      return response.ok([])
    }

    const books = await Book.query()
      .whereNot('id', book.id)
      .where('nsfw', nsfw)
      .whereExists((existsQuery) => {
        existsQuery
          .from('author_books as ab')
          .whereRaw('ab.book_id = books.id')
          .whereIn('ab.author_id', authorIds)
      })
      .preload('authors')
      .orderBy('rating', 'desc')
      .limit(5)

    return response.ok(books)
  }
}
