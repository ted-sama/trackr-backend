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
   * @paramQuery nsfw - Whether to include NSFW books - @type(boolean)
   * @responseBody 200 - <Book[]>.paginated() - List of books with pagination
   * @responseBody 400 - Bad request
   */
  async index({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const sort = request.input('sort') as 'top_rated' | 'most_listed' | 'most_tracked' | undefined
    const nsfw = request.input('nsfw', false)

    const query = Book.query().preload('authors').select('*')

    if (nsfw) {
      query.where('nsfw', true)
    }

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

    // Optimized search using raw SQL for better performance with indexes
    const books = await db
      .from('books')
      .select('books.*')
      .select(
        db.raw(
          `
        CASE 
          WHEN LOWER(books.title) = ? THEN 100
          WHEN LOWER(books.title) LIKE ? THEN 90
          WHEN alternative_titles::jsonb @> ?::jsonb THEN 85
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(alternative_titles::jsonb) AS alt_title
            WHERE alt_title ILIKE ?
          ) THEN 80
          WHEN EXISTS (
            SELECT 1
            FROM author_books ab
            INNER JOIN authors a ON a.id = ab.author_id
            WHERE ab.book_id = books.id
              AND LOWER(a.name) LIKE ?
          ) THEN 70
          WHEN books.search_text ILIKE ? THEN 60
          ELSE 50
        END as relevance_score
      `,
          [
            normalizedQuery,
            `${normalizedQuery}%`,
            JSON.stringify([normalizedQuery]),
            `%${normalizedQuery}%`,
            `%${normalizedQuery}%`,
            `%${normalizedQuery}%`,
          ]
        )
      )
      .where((searchQuery) => {
        searchQuery
          .whereRaw('LOWER(books.title) = ?', [normalizedQuery])
          .orWhereRaw('LOWER(books.title) LIKE ?', [`%${normalizedQuery}%`])
          .orWhereRaw('alternative_titles::jsonb @> ?::jsonb', [JSON.stringify([normalizedQuery])])
          .orWhereRaw(
            `EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(alternative_titles::jsonb) AS alt_title
              WHERE alt_title ILIKE ?
            )`,
            [`%${normalizedQuery}%`]
          )
          .where('books.nsfw', nsfw)
          .orWhereRaw(
            `EXISTS (
              SELECT 1
              FROM author_books ab
              INNER JOIN authors a ON a.id = ab.author_id
              WHERE ab.book_id = books.id
                AND LOWER(a.name) LIKE ?
            )`,
            [`%${normalizedQuery}%`]
          )
          .orWhereRaw('books.search_text ILIKE ?', [`%${normalizedQuery}%`])
      })
      .orderBy('relevance_score', 'desc')
      .orderByRaw('books.rating_count DESC NULLS LAST')
      .orderByRaw('books.rating DESC NULLS LAST')
      .paginate(page, limit)

    // Manually load authors for the results in a single efficient query
    const bookIds = books.all().map((book: any) => book.id)
    if (bookIds.length > 0) {
      const authorsData = await db
        .from('authors')
        .select('authors.*', 'author_books.book_id')
        .innerJoin('author_books', 'author_books.author_id', 'authors.id')
        .whereIn('author_books.book_id', bookIds)

      // Map authors to books
      const authorsMap = new Map<number, any[]>()
      for (const authorData of authorsData) {
        if (!authorsMap.has(authorData.book_id)) {
          authorsMap.set(authorData.book_id, [])
        }
        authorsMap.get(authorData.book_id)!.push({
          id: authorData.id,
          name: authorData.name,
          createdAt: authorData.created_at,
          updatedAt: authorData.updated_at,
        })
      }

      // Attach authors to books
      books.all().forEach((book: any) => {
        book.authors = authorsMap.get(book.id) || []
      })
    }

    return response.ok(books)
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
