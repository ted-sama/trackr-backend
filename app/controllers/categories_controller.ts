import type { HttpContext } from '@adonisjs/core/http'
import Category from '#models/category'

export default class CategoriesController {
  async index({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)

    const categories = await Category.query().paginate(page, limit)
    return response.ok(categories)
  }

  async show({ params, response }: HttpContext) {
    const category = await Category.query().where('id', params.id).preload('books').first()

    if (!category) {
      return response.notFound({ message: 'Category not found' })
    }
    return response.ok(category)
  }
}
