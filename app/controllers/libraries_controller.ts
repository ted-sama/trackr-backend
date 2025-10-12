import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import AppError from '#exceptions/app_error'
import {
  addToTopBooksValidator,
  removeFromTopBooksValidator,
  updateLibraryValidator,
} from '#validators/library'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { ActivityLogger } from '#services/activity_logger'

export default class LibraryController {
  /**
   * @summary Get user's library
   * @tag Library
   * @description Returns the authenticated user's library with reading progress and tracking information
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page - @type(number)
   * @responseBody 200 - <BookTracking[]>.with(book).paginated() - User's library with book tracking
   * @responseBody 401 - Unauthorized
   */
  async index({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const page = request.input('page', 1)
    const limit = request.input('limit', 10)

    const library = await user
      .related('bookTrackings')
      .query()
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors')
      })
      .paginate(page, limit)

    return response.ok(library)
  }

  /**
   * @summary Add book to library
   * @tag Library
   * @description Adds a book to the user's library for tracking
   * @paramPath bookId - Book ID - @type(number) @required
   * @responseBody 201 - {"message": "string", "bookId": "number"} - Book added to library
   * @responseBody 409 - {"code": "BOOK_ALREADY_IN_LIBRARY", "message": "Book already in library"} - Book already in library
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - Book not found
   * @responseBody 409 - Book already in library
   */
  async add({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.findOrFail(params.bookId)

    const existingTracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', book.id)
      .first()

    if (existingTracking) {
      throw new AppError('Book already in library', {
        status: 409,
        code: 'BOOK_ALREADY_IN_LIBRARY',
      })
    }

    await user.related('bookTrackings').create({ bookId: book.id, status: 'plan_to_read' })
    await ActivityLogger.log({
      userId: user.id,
      action: 'book.addedToLibrary',
      metadata: {},
      resourceType: 'book',
      resourceId: book.id,
    })

    return response.created({ message: 'Book added to library', bookId: book.id })
  }

  /**
   * @summary Remove book from library
   * @tag Library
   * @description Removes a book from the user's library and deletes tracking data
   * @paramPath bookId - Book ID - @type(number) @required
   * @responseBody 204 - Book removed from library
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - {"code": "BOOK_NOT_FOUND_IN_LIBRARY", "message": "Book not found in library"} - Book not found in library
   */
  async remove({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.findOrFail(params.bookId)

    const bookTracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', book.id)
      .firstOrFail()

    if (!bookTracking) {
      throw new AppError('Book not found in library', {
        status: 404,
        code: 'BOOK_NOT_FOUND_IN_LIBRARY',
      })
    }

    await bookTracking.delete()
    await ActivityLogger.log({
      userId: user.id,
      action: 'book.removedFromLibrary',
      metadata: {},
      resourceType: 'book',
      resourceId: book.id,
    })

    return response.noContent()
  }

  /**
   * @summary Update book tracking
   * @tag Library
   * @description Updates tracking information for a book in the user's library
   * @paramPath bookId - Book ID - @type(number) @required
   * @requestBody <updateLibraryValidator> - Book tracking update data
   * @responseBody 200 - <BookTracking> - Updated book tracking
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - {"code": "BOOK_NOT_FOUND_IN_LIBRARY", "message": "Book not found in library"} - Book not found in library
   * @responseBody 422 - Validation error
   */
  async update({ auth, params, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.findOrFail(params.bookId)
    const payload = await request.validateUsing(updateLibraryValidator)
    const { rating, currentChapter, currentVolume, status, notes } = payload

    const bookTracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', book.id)
      .firstOrFail()

    if (!bookTracking) {
      throw new AppError('Book not found in library', {
        status: 404,
        code: 'BOOK_NOT_FOUND_IN_LIBRARY',
      })
    }

    if (status === 'reading' && bookTracking.status !== 'reading') {
      bookTracking.merge({ startDate: DateTime.now() })
    }

    if (status === 'completed' && bookTracking.status !== 'completed') {
      bookTracking.merge({ finishDate: DateTime.now() })
    }

    if (rating && rating === 0) {
      bookTracking.merge({ rating: null })
    }

    if (
      (currentChapter && currentChapter !== bookTracking.currentChapter) ||
      (currentVolume && currentVolume !== bookTracking.currentVolume)
    ) {
      bookTracking.merge({ lastReadAt: DateTime.now() })
    }

    bookTracking.merge({ rating, currentChapter, currentVolume, status, notes })
    await bookTracking.save()
    // log activity for each field that was updated
    Object.entries(payload).forEach(async ([field, value]) => {
      if (value) {
        await ActivityLogger.log({
          userId: user.id,
          action: `book.${field}Updated`,
          metadata: { [field]: value },
          resourceType: 'book',
          resourceId: book.id,
        })
      }
    })

    const updatedBookTracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', book.id)
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors')
      })
      .first()

    return response.ok(updatedBookTracking)
  }

  async addToTopBooks({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { params } = await request.validateUsing(addToTopBooksValidator)
    const book = await Book.find(params.bookId)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    const existingRelation = await user
      .related('topBooks')
      .query()
      .where('book_id', book.id)
      .first()
    if (existingRelation) {
      throw new AppError('Book already in top books', {
        status: 409,
        code: 'BOOK_ALREADY_IN_TOP',
      })
    }

    const topBooksCount = await user.related('topBooks').query().count('* as total')
    const totalTopBooks = Number(topBooksCount[0].$extras.total ?? 0)

    if (totalTopBooks >= 5) {
      throw new AppError('You can only have 5 top books', {
        status: 409,
        code: 'BOOKS_TOP_LIMIT_REACHED',
      })
    }

    const nextPosition = totalTopBooks + 1

    await user.related('topBooks').attach({
      [book.id]: {
        position: nextPosition,
        created_at: new Date(),
        updated_at: new Date(),
      },
    })

    await ActivityLogger.log({
      userId: user.id,
      action: 'book.addedToFavorites',
      metadata: {},
      resourceType: 'book',
      resourceId: book.id,
    })

    return response.ok({ message: 'Book added to top books' })
  }

  async removeFromTopBooks({ auth, request, response }: HttpContext) {
    const { params } = await request.validateUsing(removeFromTopBooksValidator)
    const user = await auth.authenticate()
    const book = await Book.find(params.bookId)
    if (!book) {
      throw new AppError('Book not found', {
        status: 404,
        code: 'BOOK_NOT_FOUND',
      })
    }

    const existingRelation = await user
      .related('topBooks')
      .query()
      .where('book_id', book.id)
      .first()
    if (!existingRelation) {
      throw new AppError('Book not found in top books', {
        status: 404,
        code: 'BOOK_NOT_FOUND_IN_TOP',
      })
    }

    await user.related('topBooks').detach([book.id])

    const removedPosition = Number(existingRelation.$extras.pivot_position ?? 0)

    await db.rawQuery(
      'UPDATE users_top_books SET position = position - 1, updated_at = ? WHERE user_id = ? AND position > ?',
      [new Date(), user.id, removedPosition]
    )

    await ActivityLogger.log({
      userId: user.id,
      action: 'book.removedFromFavorites',
      metadata: {},
      resourceType: 'book',
      resourceId: book.id,
    })

    return response.ok({ message: 'Book removed from top books' })
  }
}
