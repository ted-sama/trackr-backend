import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'
import { updateLibraryValidator } from '#validators/library'

export default class LibraryController {
  async index({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const page = request.input('page', 1)
    const limit = request.input('limit', 10)

    const library = await user.related('bookTrackings').query().preload('book').paginate(page, limit)

    return response.ok(library)
  }
  async add({ auth, params, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.findOrFail(params.bookId)

    const existingTracking = await user.related('bookTrackings').query().where('book_id', book.id).first()

    if (existingTracking) {
      return response.conflict({ message: 'Book already in library' })
    }

    await user.related('bookTrackings').create({ bookId: book.id })

    return response.created({ message: 'Book added to library', bookId: book.id })
  }

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

  async update({ auth, params, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const book = await Book.findOrFail(params.bookId)
    const payload = await request.validateUsing(updateLibraryValidator)

    const bookTracking = await user
      .related('bookTrackings')
      .query()
      .where('book_id', book.id)
      .firstOrFail()

    bookTracking.merge(payload)
    await bookTracking.save()

    return response.ok(bookTracking)
  }
}
