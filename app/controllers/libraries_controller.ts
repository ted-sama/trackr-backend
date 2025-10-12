import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import AppError from '#exceptions/app_error'
import {
  addToTopBooksValidator,
  removeFromTopBooksValidator,
  updateLibraryValidator,
} from '#validators/library'
import BookTracking from '#models/book_tracking'
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

    const deletedTracking = await BookTracking.query()
      .where('user_id', user.id)
      .where('book_id', book.id)
      .delete()

    if (deletedTracking.length === 0) {
      throw new AppError('Book not found in library', {
        status: 404,
        code: 'BOOK_NOT_FOUND_IN_LIBRARY',
      })
    }

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
    const { rating, currentChapter, currentVolume, status } = payload

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

    const dataToUpdate: { [key: string]: any } = {}

    // Copier les valeurs du payload dans dataToUpdate
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined) {
        dataToUpdate[key] = value
      }
    })

    // Gérer le rating à 0 = null
    if (rating !== undefined && rating === 0) {
      dataToUpdate.rating = null
    }

    // Déterminer les nouvelles valeurs pour les chapitres/volumes
    const newChapter = currentChapter !== undefined ? currentChapter : bookTracking.currentChapter
    const newVolume = currentVolume !== undefined ? currentVolume : bookTracking.currentVolume
    const oldChapter = bookTracking.currentChapter
    const oldVolume = bookTracking.currentVolume

    // Déterminer le statut automatiquement
    let finalStatus = status || bookTracking.status

    // Auto-complétion : si on atteint le max de chapitres ou volumes, passer en 'completed'
    const hasReachedMaxChapters = book.chapters !== null && newChapter === book.chapters
    const hasReachedMaxVolumes = book.volumes !== null && newVolume === book.volumes

    if (hasReachedMaxChapters || hasReachedMaxVolumes) {
      finalStatus = 'completed'
    }
    // Auto-reading : si on met un chapitre/volume > 0 depuis 'plan_to_read', passer en 'reading'
    else if (
      ((currentChapter !== undefined && currentChapter > 0) ||
        (currentVolume !== undefined && currentVolume > 0)) &&
      bookTracking.status === 'plan_to_read' &&
      finalStatus === 'plan_to_read'
    ) {
      finalStatus = 'reading'
    }

    dataToUpdate.status = finalStatus

    // Gérer les transitions de statut et les dates

    // 1. Passage en 'reading' : définir startDate si pas déjà définie
    if (finalStatus === 'reading' && bookTracking.status !== 'reading') {
      if (!bookTracking.startDate) {
        dataToUpdate.startDate = DateTime.now()
      }
    }

    // 2. Passage en 'completed' : définir finishDate et mettre les chapitres/volumes au max
    if (finalStatus === 'completed' && bookTracking.status !== 'completed') {
      dataToUpdate.finishDate = DateTime.now()
      // S'assurer que les chapitres/volumes sont au max
      if (book.chapters !== null && newChapter !== book.chapters) {
        dataToUpdate.currentChapter = book.chapters
      }
      if (book.volumes !== null && newVolume !== book.volumes) {
        dataToUpdate.currentVolume = book.volumes
      }
    }

    // 3. Passage à 'plan_to_read' : reset de tout
    if (finalStatus === 'plan_to_read' && bookTracking.status !== 'plan_to_read') {
      dataToUpdate.startDate = null
      dataToUpdate.finishDate = null
      dataToUpdate.currentChapter = null
      dataToUpdate.currentVolume = null
    }

    // 4. Si on quitte 'completed' vers un autre statut : annuler finishDate
    if (bookTracking.status === 'completed' && finalStatus !== 'completed') {
      dataToUpdate.finishDate = null
    }

    // Gérer lastReadAt : mise à jour si les chapitres/volumes changent
    const chapterChanged = currentChapter !== undefined && currentChapter !== oldChapter
    const volumeChanged = currentVolume !== undefined && currentVolume !== oldVolume

    if (chapterChanged || volumeChanged) {
      dataToUpdate.lastReadAt = DateTime.now()
    }

    await BookTracking.query()
      .where('user_id', user.id)
      .where('book_id', book.id)
      .update(dataToUpdate)

    // log activity for each field that was updated
    Object.entries(payload).forEach(async ([field, value]) => {
      if (value !== undefined && value !== null) {
        await ActivityLogger.log({
          userId: user.id,
          action: `book.${field}Updated`,
          metadata: { [field]: value },
          resourceType: 'book',
          resourceId: book.id,
        })
      }
    })

    const updatedBookTracking = await BookTracking.query()
      .where('book_id', book.id)
      .where('user_id', user.id)
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
