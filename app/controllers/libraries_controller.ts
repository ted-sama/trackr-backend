import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import { updateLibraryValidator } from '#validators/library'
import BookTracking from '#models/book_tracking'
import { DateTime } from 'luxon'

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
      .preload('book')
      .paginate(page, limit)

    return response.ok(library)
  }

  /**
   * @summary Add book to library
   * @tag Library
   * @description Adds a book to the user's library for tracking
   * @paramPath bookId - Book ID - @type(number) @required
   * @responseBody 201 - {"message": "string", "bookId": "number"} - Book added to library
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
      return response.conflict({ message: 'Book already in library' })
    }

    await user.related('bookTrackings').create({ bookId: book.id })

    return response.created({ message: 'Book added to library', bookId: book.id })
  }

  /**
   * @summary Remove book from library
   * @tag Library
   * @description Removes a book from the user's library and deletes tracking data
   * @paramPath bookId - Book ID - @type(number) @required
   * @responseBody 204 - Book removed from library
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - Book not found in library
   */
  async remove({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.findOrFail(params.bookId)

    const bookTracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', book.id)
      .firstOrFail()

    await bookTracking.delete()

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
   * @responseBody 404 - Book not found in library
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

    const updatedBookTracking = await BookTracking.query()
      .where('book_id', book.id)
      .preload('book')
      .first()

    return response.ok(updatedBookTracking)
  }

  async addToTopBooks({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.find(params.id)
    if (!book) {
      return response.notFound({ message: 'Book not found' })
    }

    const existingRelation = await user
      .related('topBooks')
      .query()
      .where('book_id', book.id)
      .first()
    if (existingRelation) {
      return response.conflict({ message: 'Book already in top books' })
    }

    const topBooksCount = await user.related('topBooks').query().count('* as total')
    if (topBooksCount[0].$extras.total >= 3) {
      return response.conflict({ message: 'You can only have 3 top books' })
    }

    await user.related('topBooks').attach([book.id])
    return response.ok({ message: 'Book added to top books' })
  }

  async removeFromTopBooks({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.find(params.id)
    if (!book) {
      return response.notFound({ message: 'Book not found' })
    }

    const existingRelation = await user
      .related('topBooks')
      .query()
      .where('book_id', book.id)
      .first()
    if (!existingRelation) {
      return response.notFound({ message: 'Book not found in top books' })
    }

    await user.related('topBooks').detach([book.id])
    return response.ok({ message: 'Book removed from top books' })
  }
}
