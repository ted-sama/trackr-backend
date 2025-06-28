import type { HttpContext } from '@adonisjs/core/http'
import Book from '#models/book'

export default class BooksController {
  /**
   * Get list of books with optional pagination
   */
  async index({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)

    const books = await Book.query().paginate(page, limit)
    return response.ok(books)
  }

  /**
   * Get single book by ID
   */
  async show({ params, response }: HttpContext) {
    const book = await Book.find(params.id)
    if (!book) {
      return response.notFound({ message: 'Book not found' })
    }
    return response.ok(book)
  }
}
