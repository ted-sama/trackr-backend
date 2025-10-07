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

    const query = Book.query().preload('authors').select('*')

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

    if (!query) {
      throw new AppError('Search query is required', {
        status: 400,
        code: 'BOOK_SEARCH_QUERY_REQUIRED',
      })
    }

    const normalizedQuery = query.trim().toLowerCase()
    const prefixPattern = `${normalizedQuery}%`
    const containsPattern = `%${normalizedQuery}%`

    // Utiliser une CTE pour éviter la duplication et améliorer les performances
    const books = await db
      .rawQuery(
        `
        WITH search_matches AS (
          SELECT 
            b.id,
            CASE 
              WHEN LOWER(b.title) = :exactMatch THEN 100
              WHEN LOWER(b.title) LIKE :prefixMatch THEN 90
              WHEN b.alternative_titles::jsonb @> :exactJsonMatch THEN 85
              WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(b.alternative_titles::jsonb) AS alt
                WHERE LOWER(alt) LIKE :prefixMatch
              ) THEN 80
              WHEN EXISTS (
                SELECT 1 FROM author_books ab
                JOIN authors a ON a.id = ab.author_id
                WHERE ab.book_id = b.id AND LOWER(a.name) LIKE :containsMatch
              ) THEN 70
              WHEN b.search_text ILIKE :containsMatch THEN 60
              ELSE 50
            END as relevance_score
          FROM books b
          WHERE 
            LOWER(b.title) = :exactMatch
            OR LOWER(b.title) LIKE :containsMatch
            OR b.alternative_titles::jsonb @> :exactJsonMatch
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(b.alternative_titles::jsonb) AS alt
              WHERE LOWER(alt) LIKE :containsMatch
            )
            OR EXISTS (
              SELECT 1 FROM author_books ab
              JOIN authors a ON a.id = ab.author_id
              WHERE ab.book_id = b.id AND LOWER(a.name) LIKE :containsMatch
            )
            OR b.search_text ILIKE :containsMatch
        )
        SELECT 
          b.*,
          sm.relevance_score
        FROM search_matches sm
        JOIN books b ON b.id = sm.id
        ORDER BY sm.relevance_score DESC, b.rating_count DESC, b.rating DESC NULLS LAST
        LIMIT :limit OFFSET :offset
      `,
        {
          exactMatch: normalizedQuery,
          prefixMatch: prefixPattern,
          containsMatch: containsPattern,
          exactJsonMatch: JSON.stringify([normalizedQuery]),
          limit: limit,
          offset: (page - 1) * limit,
        }
      )
      .then((result) => result.rows)

    // Charger les relations authors
    const bookIds = books.map((book: any) => book.id)
    const booksWithAuthors =
      bookIds.length > 0 ? await Book.query().whereIn('id', bookIds).preload('authors') : []

    // Mapper les résultats avec le relevance_score
    const sortedBooks = books.map((rawBook: any) => {
      const book = booksWithAuthors.find((b) => b.id === rawBook.id)
      if (book) {
        // @ts-ignore - Ajouter le relevance_score pour debug
        book.$extras.relevance_score = rawBook.relevance_score
      }
      return book
    })

    // Compter le total pour la pagination
    const totalQuery = await db
      .rawQuery(
        `
        SELECT COUNT(DISTINCT b.id) as total
        FROM books b
        WHERE 
          LOWER(b.title) = :exactMatch
          OR LOWER(b.title) LIKE :containsMatch
          OR b.alternative_titles::jsonb @> :exactJsonMatch
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(b.alternative_titles::jsonb) AS alt
            WHERE LOWER(alt) LIKE :containsMatch
          )
          OR EXISTS (
            SELECT 1 FROM author_books ab
            JOIN authors a ON a.id = ab.author_id
            WHERE ab.book_id = b.id AND LOWER(a.name) LIKE :containsMatch
          )
          OR b.search_text ILIKE :containsMatch
      `,
        {
          exactMatch: normalizedQuery,
          containsMatch: containsPattern,
          exactJsonMatch: JSON.stringify([normalizedQuery]),
        }
      )
      .then((result) => Number.parseInt(result.rows[0].total))

    // Construire la réponse paginée manuellement
    const paginatedResponse = {
      meta: {
        total: totalQuery,
        per_page: limit,
        current_page: page,
        last_page: Math.ceil(totalQuery / limit),
        first_page: 1,
        first_page_url: `/?page=1`,
        last_page_url: `/?page=${Math.ceil(totalQuery / limit)}`,
        next_page_url: page < Math.ceil(totalQuery / limit) ? `/?page=${page + 1}` : null,
        previous_page_url: page > 1 ? `/?page=${page - 1}` : null,
      },
      data: sortedBooks,
    }

    return response.ok(paginatedResponse)
  }

  async getBySameAuthor({ params, response }: HttpContext) {
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
