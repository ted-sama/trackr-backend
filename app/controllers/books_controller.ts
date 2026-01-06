import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import AppError from '#exceptions/app_error'
import db from '@adonisjs/lucid/services/db'
import { aiTranslate } from '#helpers/ai_translate'
import { DateTime } from 'luxon'

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
    const nsfw =
      request.input('nsfw', 'false') === 'true' || request.input('nsfw', 'false') === true

    const query = Book.query().preload('authors').preload('publishers').select('*')

    // Si nsfw=false, on masque le contenu NSFW
    // Si nsfw=true, on affiche tout (pas de filtre)
    if (!nsfw) {
      query.where('nsfw', false)
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
    const book = await Book.query()
      .where('id', params.id)
      .preload('authors')
      .preload('publishers')
      .first()
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

  /**
   * @summary Search books
   * @tag Books
   * @description Search books by title, alternative titles, or author name
   * @paramQuery q - Search query - @type(string) @required
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 100) - @type(number)
   * @paramQuery nsfw - Include NSFW content - @type(boolean)
   * @paramQuery types - Filter by book types (comma-separated or array) - @type(string)
   * @responseBody 200 - <Book[]>.paginated() - Search results with pagination
   * @responseBody 400 - Bad request
   */
  async search({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const query = request.input('q')
    const nsfw =
      request.input('nsfw', 'false') === 'true' || request.input('nsfw', 'false') === true
    const typesInput = request.input('types')

    if (!query) {
      throw new AppError('Search query is required', {
        status: 400,
        code: 'BOOK_SEARCH_QUERY_REQUIRED',
      })
    }

    // Parse types filter: can be a comma-separated string or an array
    let types: string[] | null = null
    if (typesInput) {
      if (Array.isArray(typesInput)) {
        types = typesInput.filter((t: unknown) => typeof t === 'string' && t.trim().length > 0)
      } else if (typeof typesInput === 'string') {
        types = typesInput
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      }
      if (types && types.length === 0) {
        types = null
      }
    }

    const normalizedQuery = query.trim().toLowerCase()
    // Nettoyer la ponctuation pour la recherche par similarité pg_trgm
    const cleanedQuery = normalizedQuery
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const bookQuery = Book.query().select('*')

    // Si nsfw=false, on masque le contenu NSFW
    // Si nsfw=true, on affiche tout (pas de filtre)
    if (!nsfw) {
      bookQuery.where('nsfw', false)
    }

    // Filter by types if provided
    if (types && types.length > 0) {
      bookQuery.whereIn('type', types)
    }

    const searchResults = await bookQuery
      .select(
        db.raw(
          `
        CASE 
          WHEN LOWER(title) = ? THEN 100
          WHEN LOWER(title) LIKE ? THEN 95
          WHEN similarity(LOWER(title), ?) > 0.6 THEN 90
          WHEN similarity(LOWER(title), ?) > 0.4 THEN 85
          WHEN search_text ILIKE ? AND LOWER(title) != ? THEN 80
          WHEN similarity(search_text, ?) > 0.4 THEN 75
          WHEN EXISTS (
            SELECT 1 FROM author_books ab
            JOIN authors a ON a.id = ab.author_id
            WHERE ab.book_id = books.id
              AND a.name ILIKE ?
          ) THEN 70
          WHEN similarity(search_text, ?) > 0.3 THEN 65
          ELSE 50
        END as relevance_score
      `,
          [
            normalizedQuery,
            `${normalizedQuery}%`,
            cleanedQuery, // similarity > 0.6
            cleanedQuery, // similarity > 0.4
            `%${normalizedQuery}%`,
            normalizedQuery,
            cleanedQuery, // similarity search_text > 0.4
            `%${normalizedQuery}%`,
            cleanedQuery, // similarity search_text > 0.3
          ]
        )
      )
      .where((searchQuery) => {
        searchQuery
          .whereRaw('LOWER(title) = ?', [normalizedQuery])
          .orWhereILike('title', `%${normalizedQuery}%`)
          .orWhereILike('search_text', `%${normalizedQuery}%`)
          // Recherche par similarité pg_trgm (gère ponctuation, fautes de frappe, etc.)
          .orWhereRaw('similarity(LOWER(title), ?) > 0.3', [cleanedQuery])
          .orWhereRaw('search_text % ?', [cleanedQuery])
          .orWhereExists((existsQuery) => {
            existsQuery
              .from('author_books as ab')
              .innerJoin('authors as a', 'a.id', 'ab.author_id')
              .whereRaw('ab.book_id = books.id')
              .whereILike('a.name', `%${normalizedQuery}%`)
          })
          // Recherche par similarité sur les noms d'auteurs
          .orWhereExists((existsQuery) => {
            existsQuery
              .from('author_books as ab')
              .innerJoin('authors as a', 'a.id', 'ab.author_id')
              .whereRaw('ab.book_id = books.id')
              .whereRaw('similarity(LOWER(a.name), ?) > 0.3', [cleanedQuery])
          })
      })
      .preload('authors')
      .preload('publishers')
      .orderByRaw('relevance_score DESC, rating_count DESC NULLS LAST, rating DESC NULLS LAST')
      .paginate(page, limit)

    return response.ok(searchResults)
  }

  async getBySame({ params, request, response }: HttpContext) {
    const nsfw =
      request.input('nsfw', 'false') === 'true' || request.input('nsfw', 'false') === true

    const book = await Book.find(params.id)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    await book.load('authors')
    await book.load('publishers')

    const authorIds = book.authors.map((author) => author.id)
    const publisherIds = book.publishers.map((publisher) => publisher.id)

    // Cas 1: Le livre a des auteurs -> recherche par auteur
    if (authorIds.length > 0) {
      const booksQuery = Book.query().whereNot('id', book.id)

      // Si nsfw=false, on masque le contenu NSFW
      // Si nsfw=true, on affiche tout (pas de filtre)
      if (!nsfw) {
        booksQuery.where('nsfw', false)
      }

      const books = await booksQuery
        .whereExists((existsQuery) => {
          existsQuery
            .from('author_books as ab')
            .whereRaw('ab.book_id = books.id')
            .whereIn('ab.author_id', authorIds)
        })
        .preload('authors')
        .preload('publishers')
        .orderBy('rating', 'desc')
        .limit(5)

      return response.ok(books)
    }

    // Cas 2: Le livre n'a pas d'auteur (comics) -> recherche par publisher et année
    if (publisherIds.length > 0 && book.releaseYear) {
      const booksQuery = Book.query().whereNot('id', book.id)

      // Si nsfw=false, on masque le contenu NSFW
      // Si nsfw=true, on affiche tout (pas de filtre)
      if (!nsfw) {
        booksQuery.where('nsfw', false)
      }

      const books = await booksQuery
        .whereExists((existsQuery) => {
          existsQuery
            .from('book_publishers as bp')
            .whereRaw('bp.book_id = books.id')
            .whereIn('bp.publisher_id', publisherIds)
        })
        .where('release_year', book.releaseYear)
        .preload('authors')
        .preload('publishers')
        .orderBy('rating', 'desc')
        .limit(5)

      return response.ok(books)
    }

    // Aucune donnée suffisante pour faire une recherche
    return response.ok([])
  }

  /**
   * @summary Get popular books this month
   * @tag Books
   * @description Returns popular books based on user interactions this month (list additions, reviews, chapter reads)
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 50) - @type(number)
   * @paramQuery nsfw - Include NSFW content - @type(boolean)
   * @responseBody 200 - <Book[]>.paginated() - Popular books with pagination
   */
  async popular({ request, response }: HttpContext) {
    const page = Math.max(1, request.input('page', 1))
    const limit = Math.min(Math.max(1, request.input('limit', 20)), 50)
    const offset = (page - 1) * limit
    const nsfw =
      request.input('nsfw', 'false') === 'true' || request.input('nsfw', 'false') === true

    // Use a rolling 30-day window for popularity
    const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toSQL()

    // Subquery for popularity score (last 30 days)
    const popularitySubquery = `
      COALESCE((SELECT COUNT(DISTINCT lb.list_id)::int FROM list_books lb JOIN lists l ON l.id = lb.list_id WHERE lb.book_id = books.id AND lb.added_at >= ? AND l.is_my_library = false), 0) +
      COALESCE((SELECT COUNT(*)::int FROM book_reviews br WHERE br.book_id = books.id AND br.created_at >= ?), 0) +
      COALESCE((SELECT COUNT(*)::int FROM book_tracking bt WHERE bt.book_id = books.id AND bt.created_at >= ?), 0)
    `

    // Count total books with interactions in the last 30 days
    const countResult = await db.rawQuery(
      `SELECT COUNT(*) as count FROM books WHERE ${!nsfw ? 'nsfw = false AND' : ''} (${popularitySubquery}) > 0`,
      [thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo]
    )
    const total = Number.parseInt(
      (countResult.rows as Array<{ count: string }>)[0]?.count || '0',
      10
    )

    // Get only books with recent interactions, ordered by popularity score
    const books = await Book.query()
      .select('books.*')
      .select(
        db.raw(`(${popularitySubquery}) AS popularity_score`, [
          thirtyDaysAgo,
          thirtyDaysAgo,
          thirtyDaysAgo,
        ])
      )
      .whereRaw(`(${popularitySubquery}) > 0`, [thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo])
      .if(!nsfw, (q) => q.where('nsfw', false))
      .preload('authors')
      .preload('publishers')
      .orderByRaw(
        `(${popularitySubquery}) DESC, rating_count DESC NULLS LAST, rating DESC NULLS LAST`,
        [thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo]
      )
      .limit(limit)
      .offset(offset)

    // Build pagination response
    const lastPage = Math.max(1, Math.ceil(total / limit))
    return response.ok({
      meta: {
        total,
        perPage: limit,
        currentPage: page,
        lastPage,
        firstPage: 1,
        firstPageUrl: '/?page=1',
        lastPageUrl: `/?page=${lastPage}`,
        nextPageUrl: page < lastPage ? `/?page=${page + 1}` : null,
        previousPageUrl: page > 1 ? `/?page=${page - 1}` : null,
      },
      data: books,
    })
  }
}
