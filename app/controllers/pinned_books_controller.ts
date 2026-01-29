import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import PinnedBook from '#models/pinned_book'
import Book from '#models/book'
import User from '#models/user'
import { pinBookValidator, updatePinnedBookValidator } from '#validators/pinned_book_validator'
import AppError from '#exceptions/app_error'

@inject()
export default class PinnedBooksController {
  /**
   * Get the current user's pinned book
   */
  async show({ auth, response }: HttpContext) {
    const user = auth.user

    if (!user) {
      throw new AppError('Unauthorized', { status: 401 })
    }

    const pinnedBook = await PinnedBook.query()
      .where('user_id', user.id)
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors')
        bookQuery.preload('publishers')
      })
      .first()

    if (!pinnedBook) {
      return response.ok({
        pinnedBook: null,
      })
    }

    return response.ok({
      pinnedBook: {
        id: pinnedBook.id,
        bookId: pinnedBook.bookId,
        summary: pinnedBook.$extras?.summary || null,
        book: pinnedBook.book
          ? {
              id: pinnedBook.book.id,
              title: pinnedBook.book.title,
              coverImage: pinnedBook.book.coverImage,
              authors: pinnedBook.book.authors,
              publishers: pinnedBook.book.publishers,
              totalChapters: pinnedBook.book.totalChapters,
              type: pinnedBook.book.type,
            }
          : null,
        createdAt: pinnedBook.createdAt,
        updatedAt: pinnedBook.updatedAt,
      },
    })
  }

  /**
   * Pin a book (only one book can be pinned per user)
   */
  async store({ auth, request, response }: HttpContext) {
    const user = auth.user

    if (!user) {
      throw new AppError('Unauthorized', { status: 401 })
    }

    // Check if user is premium
    if (!user.isPremium) {
      throw new AppError('Pinned Book is a Trackr Plus feature', {
        status: 403,
        code: 'PREMIUM_REQUIRED',
      })
    }

    const data = await request.validateUsing(pinBookValidator)

    // Check if book exists
    const book = await Book.find(data.bookId)
    if (!book) {
      throw new AppError('Book not found', { status: 404 })
    }

    // Check if already pinned (update instead)
    const existingPinned = await PinnedBook.query()
      .where('user_id', user.id)
      .first()

    if (existingPinned) {
      // Update the existing pinned book
      existingPinned.bookId = data.bookId
      await existingPinned.save()

      // Reload with relations
      await existingPinned.load('book')

      return response.ok({
        message: 'Pinned book updated successfully',
        pinnedBook: {
          id: existingPinned.id,
          bookId: existingPinned.bookId,
          summary: existingPinned.$extras?.summary || null,
          book: {
            id: existingPinned.book.id,
            title: existingPinned.book.title,
            coverImage: existingPinned.book.coverImage,
            authors: existingPinned.book.authors,
            publishers: existingPinned.book.publishers,
            totalChapters: existingPinned.book.totalChapters,
            type: existingPinned.book.type,
          },
          createdAt: existingPinned.createdAt,
          updatedAt: existingPinned.updatedAt,
        },
      })
    }

    // Create new pinned book
    const pinnedBook = await PinnedBook.create({
      userId: user.id,
      bookId: data.bookId,
    })

    await pinnedBook.load('book')

    return response.created({
      message: 'Book pinned successfully',
      pinnedBook: {
        id: pinnedBook.id,
        bookId: pinnedBook.bookId,
        summary: pinnedBook.$extras?.summary || null,
        book: {
          id: pinnedBook.book.id,
          title: pinnedBook.book.title,
          coverImage: pinnedBook.book.coverImage,
          authors: pinnedBook.book.authors,
          publishers: pinnedBook.book.publishers,
          totalChapters: pinnedBook.book.totalChapters,
          type: pinnedBook.book.type,
        },
        createdAt: pinnedBook.createdAt,
        updatedAt: pinnedBook.updatedAt,
      },
    })
  }

  /**
   * Update pinned book (e.g., add AI summary)
   */
  async update({ auth, request, response }: HttpContext) {
    const user = auth.user

    if (!user) {
      throw new AppError('Unauthorized', { status: 401 })
    }

    if (!user.isPremium) {
      throw new AppError('Pinned Book is a Trackr Plus feature', {
        status: 403,
        code: 'PREMIUM_REQUIRED',
      })
    }

    const data = await request.validateUsing(updatePinnedBookValidator)

    const pinnedBook = await PinnedBook.query()
      .where('user_id', user.id)
      .first()

    if (!pinnedBook) {
      throw new AppError('No pinned book found', { status: 404 })
    }

    // Update summary if provided
    if (data.summary !== undefined) {
      await pinnedBook.$query().update({ summary: data.summary })
      pinnedBook.$extras.summary = data.summary
    }

    return response.ok({
      message: 'Pinned book updated successfully',
      pinnedBook: {
        id: pinnedBook.id,
        bookId: pinnedBook.bookId,
        summary: pinnedBook.$extras?.summary || null,
        createdAt: pinnedBook.createdAt,
        updatedAt: pinnedBook.updatedAt,
      },
    })
  }

  /**
   * Remove pinned book
   */
  async destroy({ auth, response }: HttpContext) {
    const user = auth.user

    if (!user) {
      throw new AppError('Unauthorized', { status: 401 })
    }

    const pinnedBook = await PinnedBook.query()
      .where('user_id', user.id)
      .first()

    if (!pinnedBook) {
      throw new AppError('No pinned book found', { status: 404 })
    }

    await pinnedBook.delete()

    return response.ok({
      message: 'Pinned book removed successfully',
    })
  }

  /**
   * Get pinned book with reading progress from book tracking
   */
  async withProgress({ auth, response }: HttpContext) {
    const user = auth.user

    if (!user) {
      throw new AppError('Unauthorized', { status: 401 })
    }

    const pinnedBook = await PinnedBook.query()
      .where('user_id', user.id)
      .preload('book', (bookQuery) => {
        bookQuery.preload('authors')
        bookQuery.preload('publishers')
      })
      .first()

    if (!pinnedBook) {
      return response.ok({
        pinnedBook: null,
        progress: null,
      })
    }

    // Get reading progress if the book is being tracked
    const tracking = await pinnedBook.related('book')
      .query()
      .whereExists((query) => {
        query
          .from('book_trackings')
          .where('book_id', pinnedBook.bookId)
          .andWhere('user_id', user.id)
      })
      .first()

    let progress = null
    if (tracking) {
      const bookTracking = await pinnedBook
        .$relatedModel('book')
        .$query()
        .where('book_id', pinnedBook.bookId)
        .andWhere('user_id', user.id)
        .first()

      if (bookTracking) {
        progress = {
          status: bookTracking.status,
          currentChapter: bookTracking.currentChapter,
          currentVolume: bookTracking.currentVolume,
          lastReadAt: bookTracking.lastReadAt,
          totalChapters: pinnedBook.book.totalChapters,
          progressPercentage:
            pinnedBook.book.totalChapters && bookTracking.currentChapter
              ? Math.round((bookTracking.currentChapter / pinnedBook.book.totalChapters) * 100)
              : null,
        }
      }
    }

    return response.ok({
      pinnedBook: {
        id: pinnedBook.id,
        bookId: pinnedBook.bookId,
        summary: pinnedBook.$extras?.summary || null,
        book: pinnedBook.book
          ? {
              id: pinnedBook.book.id,
              title: pinnedBook.book.title,
              coverImage: pinnedBook.book.coverImage,
              authors: pinnedBook.book.authors,
              publishers: pinnedBook.book.publishers,
              totalChapters: pinnedBook.book.totalChapters,
              type: pinnedBook.book.type,
              dominantColor: pinnedBook.book.dominantColor,
            }
          : null,
        createdAt: pinnedBook.createdAt,
        updatedAt: pinnedBook.updatedAt,
      },
      progress,
    })
  }
}
