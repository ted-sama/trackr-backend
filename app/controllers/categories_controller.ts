import type { HttpContext } from '@adonisjs/core/http'
import Category from '#models/category'

export default class CategoriesController {
  /**
   * @summary Get list of categories
   * @tag Categories
   * @description Returns a paginated list of categories with their associated books
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 100) - @type(number)
   * @responseBody 200 - <Category[]>.with(books).paginated() - List of categories with pagination
   * @responseBody 400 - Bad request
   */
  async index({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)

    const categories = await Category.query().preload('books').paginate(page, limit)
    return response.ok(categories)
  }

  /**
   * @summary Get category by ID
   * @tag Categories
   * @description Returns a single category by its ID with all associated books
   * @paramPath id - Category ID - @type(number) @required
   * @responseBody 200 - <Category>.with(books) - Category details with associated books
   * @responseBody 404 - Category not found
   */
  async show({ params, response }: HttpContext) {
    const category = await Category.query().where('id', params.id).preload('books').first()

    if (!category) {
      return response.notFound({ message: 'Category not found' })
    }
    return response.ok(category)
  }
}
