import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import AppError from '#exceptions/app_error'
import {
  addToTopBooksValidator,
  removeFromTopBooksValidator,
  updateLibraryValidator,
} from '#validators/library'
import {
  malImportValidator,
  malUsernameImportValidator,
  mangacollecUsernameImportValidator,
} from '#validators/mal_import'
import BookTracking from '#models/book_tracking'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { ActivityLogger } from '#services/activity_logger'
import ActivityLog from '#models/activity_log'
import User from '#models/user'
import { MalImportService, type PendingImportBook } from '#services/mal_import_service'
import { MangacollecImportService } from '#services/mangacollec_import_service'
import { readFile, unlink } from 'node:fs/promises'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

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
        bookQuery.preload('authors').preload('publishers')
      })
      .paginate(page, limit)

    return response.ok(library)
  }

  /**
   * @summary Get any user's library by username
   * @tag Library
   * @description Returns a specific user's library with reading progress and tracking information
   * @paramPath username - Username - @type(string) @required
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page - @type(number)
   * @responseBody 200 - <BookTracking[]>.with(book).paginated() - User's library with book tracking
   * @responseBody 403 - Library is private
   * @responseBody 404 - User not found
   */
  async showUserBooks({ auth, params, request, response }: HttpContext) {
    const user = await User.findBy('username', params.username)
    if (!user) {
      return response.notFound({ message: 'User not found' })
    }

    // Check if current user is the owner (to allow viewing own private library)
    const currentUser = (await auth.check()) ? auth.user : null
    const isOwner = currentUser?.id === user.id

    // Check if library is private and requester is not the owner
    if (!user.isLibraryPublic && !isOwner) {
      throw new AppError("This user's library is private", {
        status: 403,
        code: 'LIBRARY_PRIVATE',
      })
    }

    const page = request.input('page', 1)
    const limit = request.input('limit', 10)

    const library = await user
      .related('bookTrackings')
      .query()
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors').preload('publishers')
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

    const dataToUpdate: { [key: string]: any } = { ...payload }

    if (status === 'reading' && bookTracking.status !== 'reading') {
      dataToUpdate.startDate = DateTime.now()
    }

    if (status === 'completed' && bookTracking.status !== 'completed') {
      dataToUpdate.finishDate = DateTime.now()
    }

    if (rating !== undefined) {
      if (rating === 0) {
        dataToUpdate.rating = null
        dataToUpdate.ratedAt = null
      } else if (rating !== bookTracking.rating) {
        dataToUpdate.ratedAt = DateTime.now()
      }
    }

    if (
      (currentChapter && currentChapter !== bookTracking.currentChapter) ||
      (currentVolume && currentVolume !== bookTracking.currentVolume)
    ) {
      dataToUpdate.lastReadAt = DateTime.now()
    }

    // Handle deletion of activity logs when chapter/volume count decreases
    if (
      currentChapter !== undefined &&
      bookTracking.currentChapter !== null &&
      currentChapter < bookTracking.currentChapter
    ) {
      // Delete activity logs for chapters that are being unmarked as read
      await ActivityLog.query()
        .where('user_id', user.id)
        .where('resource_type', 'book')
        .where('resource_id', book.id.toString())
        .where('action', 'book.currentChapterUpdated')
        .whereRaw("CAST(metadata->>'currentChapter' AS INTEGER) > ?", [currentChapter])
        .delete()
    }

    if (
      currentVolume !== undefined &&
      bookTracking.currentVolume !== null &&
      currentVolume < bookTracking.currentVolume
    ) {
      // Delete activity logs for volumes that are being unmarked as read
      await ActivityLog.query()
        .where('user_id', user.id)
        .where('resource_type', 'book')
        .where('resource_id', book.id.toString())
        .where('action', 'book.currentVolumeUpdated')
        .whereRaw("CAST(metadata->>'currentVolume' AS INTEGER) > ?", [currentVolume])
        .delete()
    }

    await BookTracking.query()
      .where('user_id', user.id)
      .where('book_id', book.id)
      .update(dataToUpdate)

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

    const updatedBookTracking = await BookTracking.query()
      .where('book_id', book.id)
      .where('user_id', user.id)
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors').preload('publishers')
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

  /**
   * @summary Toggle pin status for a book in library
   * @tag Library
   * @description Toggles whether a book is pinned in the user's library (pinned books appear first)
   * @paramPath bookId - Book ID - @type(number) @required
   * @responseBody 200 - <BookTracking>.with(book) - Updated book tracking with pin status
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - Book not found in library
   */
  async togglePin({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()

    const bookTracking = await BookTracking.query()
      .where('user_id', user.id)
      .where('book_id', params.bookId)
      .firstOrFail()

    bookTracking.isPinnedInLibrary = !bookTracking.isPinnedInLibrary
    await bookTracking.save()

    await bookTracking.load('book', (q) => q.preload('authors').preload('publishers'))

    return response.ok(bookTracking)
  }

  /**
   * @summary Import library from MyAnimeList
   * @tag Library
   * @description Imports manga entries from a MyAnimeList XML export file into user's library
   * @requestBody {"file": "XML file from MAL export (can be .xml or .xml.gz)"}
   * @responseBody 200 - Import results with counts and details
   * @responseBody 400 - Invalid file or import error
   * @responseBody 401 - Unauthorized
   */
  async importFromMal({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(malImportValidator)
    const file = payload.file

    if (!file.tmpPath) {
      throw new AppError('No file uploaded', {
        status: 400,
        code: 'NO_FILE_UPLOADED',
      })
    }

    let xmlContent: string

    try {
      // Check if file is gzipped
      if (file.extname === 'gz' || file.clientName?.endsWith('.gz')) {
        // Decompress gzipped file
        const tmpXmlPath = join(tmpdir(), `mal-import-${randomUUID()}.xml`)
        await pipeline(
          createReadStream(file.tmpPath),
          createGunzip(),
          createWriteStream(tmpXmlPath)
        )
        xmlContent = await readFile(tmpXmlPath, 'utf-8')
        await unlink(tmpXmlPath).catch(() => {})
      } else {
        // Read XML directly
        xmlContent = await readFile(file.tmpPath, 'utf-8')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new AppError(`Failed to read file: ${errorMessage}`, {
        status: 400,
        code: 'FILE_READ_ERROR',
      })
    }

    // Fetch from MAL XML (no tracking created yet)
    const importService = new MalImportService(user.id)
    const result = await importService.fetchFromXml(xmlContent)

    // Return appropriate status
    if (result.errors.length > 0 && result.pendingBooks.length === 0) {
      return response.badRequest({
        success: false,
        message: 'Fetch failed',
        ...result,
      })
    }

    return response.ok({
      success: true,
      message: `Found ${result.pendingBooks.length} manga(s) to import from MyAnimeList XML`,
      ...result,
    })
  }

  /**
   * @summary Fetch library from MyAnimeList using username (step 1)
   * @tag Library
   * @description Fetches manga entries from a public MyAnimeList profile without importing them.
   *              Returns pending books for user review before confirmation.
   * @requestBody {"username": "MAL username"}
   * @responseBody 200 - Pending books and stats
   * @responseBody 400 - Invalid username or fetch error
   * @responseBody 401 - Unauthorized
   */
  async fetchFromMalUsername({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(malUsernameImportValidator)
    const { username } = payload

    // Fetch from MAL (no tracking created yet)
    const importService = new MalImportService(user.id)
    const result = await importService.fetchFromUsername(username)

    // Return appropriate status
    if (result.errors.length > 0 && result.pendingBooks.length === 0) {
      const errorMessage = result.errors.join(' ').toLowerCase()
      const errorCode = errorMessage.includes('not found on myanimelist')
        ? 'MAL_USER_NOT_FOUND'
        : 'MAL_IMPORT_FAILED'

      return response.badRequest({
        success: false,
        message: 'Fetch failed',
        code: errorCode,
        ...result,
      })
    }

    return response.ok({
      success: true,
      message: `Found ${result.pendingBooks.length} manga(s) to import from MyAnimeList user "${username}"`,
      ...result,
    })
  }

  /**
   * @summary Fetch library from Mangacollec using username or URL (step 1)
   * @tag Library
   * @description Fetches manga series from a public Mangacollec collection without importing them.
   *              Returns pending books for user review before confirmation.
   * @requestBody {"username": "Mangacollec username or profile URL"}
   * @responseBody 200 - Pending books and stats
   * @responseBody 400 - Invalid username or fetch error
   * @responseBody 401 - Unauthorized
   */
  async fetchFromMangacollec({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(mangacollecUsernameImportValidator)
    const { username } = payload

    const importService = new MangacollecImportService(user.id)
    const result = await importService.fetchFromUsername(username)

    if (result.errors.length > 0 && result.pendingBooks.length === 0) {
      return response.badRequest({
        success: false,
        message: 'Fetch failed',
        code: 'MANGACOLLEC_IMPORT_FAILED',
        ...result,
      })
    }

    return response.ok({
      success: true,
      message: `Found ${result.pendingBooks.length} manga(s) to import from Mangacollec`,
      ...result,
    })
  }

  /**
   * @summary Confirm MAL import (step 2)
   * @tag Library
   * @description Confirms the import of selected books from the pending list.
   * @requestBody {"books": [PendingImportBook]}
   * @responseBody 200 - Import confirmation with count
   * @responseBody 400 - Import error
   * @responseBody 401 - Unauthorized
   */
  async confirmMalImport({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { books } = request.body() as { books: PendingImportBook[] }

    if (!books || !Array.isArray(books) || books.length === 0) {
      return response.badRequest({
        success: false,
        message: 'No books provided for import',
      })
    }

    // Confirm import
    const importService = new MalImportService(user.id)
    const result = await importService.confirmImport(books)

    // Log activity
    await ActivityLogger.log({
      userId: user.id,
      action: 'library.confirmedMalImport',
      metadata: {
        imported: result.imported,
        requested: books.length,
      },
      resourceType: 'user',
      resourceId: user.id,
    })

    if (result.errors.length > 0 && result.imported === 0) {
      return response.badRequest({
        success: false,
        message: 'Import failed',
        ...result,
      })
    }

    return response.ok({
      success: true,
      message: `Successfully imported ${result.imported} manga(s)`,
      ...result,
    })
  }
}
