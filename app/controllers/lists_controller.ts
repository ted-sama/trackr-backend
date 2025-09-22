import Book from '#models/book'
import List from '#models/list'
import db from '@adonisjs/lucid/services/db'
import {
  addBookSchema,
  createSchema,
  deleteSchema,
  indexByUserSchema,
  removeBookSchema,
  reorderListSchema,
  showSchema,
  updateSchema,
  updateBackdropSchema,
} from '#validators/list'
import type { HttpContext } from '@adonisjs/core/http'
import { cuid } from '@adonisjs/core/helpers'

export default class ListsController {
  /**
   * @summary Get public lists
   * @tag Lists
   * @description Returns a paginated list of public lists (excluding My Library lists)
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page - @type(number)
   * @responseBody 200 - <List[]>.with(user, bookItems).paginated() - List of public lists
   * @responseBody 400 - Bad request
   */
  public async index({ request, response }: HttpContext) {
    const { page = 1, limit = 10 } = request.qs()
    const lists = (
      await List.query()
        .where('is_my_library', false)
        .where('is_public', true)
        .preload('user')
        .preload('bookItems')
        .paginate(page, limit)
    ).serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })
    return response.ok(lists)
  }

  /**
   * @summary Search public lists
   * @tag Lists
   * @description Returns a paginated list of public lists matching the search query (excluding My Library lists)
   * @paramQuery q - Search query - @type(string) @required
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page (max 100) - @type(number)
   * @responseBody 200 - <List[]>.with(user, bookItems).paginated() - Search results with pagination
   * @responseBody 400 - Bad request
   */
  public async search({ request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const query = request.input('q')

    if (!query) {
      return response.badRequest({ message: 'Search query is required' })
    }

    const normalizedQuery = query.trim().toLowerCase()

    const lists = await List.query()
      .select('*')
      .select(
        db.raw(
          `
        CASE 
          WHEN LOWER(name) = ? THEN 100
          WHEN LOWER(name) LIKE ? THEN 90
          WHEN LOWER(description) = ? THEN 85
          WHEN LOWER(description) LIKE ? THEN 80
          WHEN EXISTS (
            SELECT 1 FROM unnest(tags) AS tag 
            WHERE LOWER(tag) = ?
          ) THEN 75
          WHEN EXISTS (
            SELECT 1 FROM unnest(tags) AS tag 
            WHERE LOWER(tag) LIKE ?
          ) THEN 70
          WHEN search_text ILIKE ? THEN 60
          ELSE 50
        END as relevance_score
      `,
          [
            normalizedQuery,
            `${normalizedQuery}%`,
            normalizedQuery,
            `${normalizedQuery}%`,
            normalizedQuery,
            `${normalizedQuery}%`,
            `%${normalizedQuery}%`,
          ]
        )
      )
      .where((searchQuery) => {
        searchQuery
          .whereRaw('LOWER(name) = ?', [normalizedQuery])
          .orWhereILike('name', `%${normalizedQuery}%`)
          .orWhereRaw('LOWER(description) = ?', [normalizedQuery])
          .orWhereILike('description', `%${normalizedQuery}%`)
          .orWhereRaw('EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE LOWER(tag) = ?)', [
            normalizedQuery,
          ])
          .orWhereRaw('EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE LOWER(tag) LIKE ?)', [
            `%${normalizedQuery}%`,
          ])
          .orWhereILike('search_text', `%${normalizedQuery}%`)
      })
      .where('is_my_library', false)
      .where('is_public', true)
      .preload('user')
      .preload('bookItems')
      .orderBy('relevance_score', 'desc')
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    const serializedLists = lists.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })

    return response.ok(serializedLists)
  }

  /**
   * @summary Get list by ID
   * @tag Lists
   * @description Returns a single list by ID. Public lists are accessible to all, private lists only to owners
   * @paramPath id - List ID - @type(number) @required
   * @responseBody 200 - <List>.with(user, bookItems) - List details
   * @responseBody 401 - Unauthorized to view private list
   * @responseBody 404 - List not found
   */
  public async show({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(showSchema)
    const { id } = payload.params
    const list = (
      await List.query()
        .where('is_my_library', false)
        .where('id', id)
        .preload('user')
        .preload('bookItems')
        .first()
    )?.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })

    if (!list) {
      return response.notFound({
        message: 'List not found',
      })
    }

    if (list.isPublic || list.owner.id === user.id) {
      return response.ok(list)
    }

    return response.unauthorized({
      message: 'You are not authorized to view this list',
    })
  }

  /**
   * @summary Get public lists by user
   * @tag Lists
   * @description Returns a paginated list of public lists created by a specific user
   * @paramPath userId - User ID - @type(string) @required
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page - @type(number)
   * @responseBody 200 - <List[]>.with(user, bookItems).paginated() - User's public lists
   * @responseBody 400 - Bad request
   */
  public async indexByUser({ request, response }: HttpContext) {
    const payload = await request.validateUsing(indexByUserSchema)
    const { userId } = payload.params
    const { page = 1, limit = 10 } = request.qs()
    const lists = (
      await List.query()
        .where('user_id', userId)
        .where('is_my_library', false)
        .where('is_public', true)
        .preload('user')
        .preload('bookItems')
        .paginate(page, limit)
    ).serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })
    return response.ok(lists)
  }

  /**
   * @summary Create a new list
   * @tag Lists
   * @description Creates a new list for the authenticated user
   * @requestBody <createSchema> - List creation data
   * @responseBody 200 - <List>.with(user) - Created list
   * @responseBody 401 - Unauthorized
   * @responseBody 422 - Validation error
   */
  public async create({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const {
      name,
      description,
      tags,
      isPublic,
      backdropMode,
      backdropColor,
      backdropImage,
      ranked,
    } = await request.validateUsing(createSchema)
    const list = await List.create({
      name,
      description,
      tags,
      isPublic,
      backdropMode,
      backdropColor,
      backdropImage,
      ranked,
      userId: user.id,
    })

    const createdList = (
      await List.query().where('id', list.id).preload('user').preload('bookItems').first()
    )?.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })

    return response.ok(createdList)
  }

  /**
   * @summary Update list
   * @tag Lists
   * @description Updates an existing list. Only the owner can update their lists
   * @paramPath id - List ID - @type(number) @required
   * @requestBody <updateSchema> - List update data
   * @responseBody 200 - <List>.with(user) - Updated list
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List not found
   * @responseBody 422 - Validation error
   */
  public async update({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(updateSchema)
    const { name, description, tags, isPublic, backdropMode, backdropColor, ranked } = payload
    const { id } = payload.params

    const list = await List.findOrFail(id)

    if (list.userId !== user.id) {
      return response.unauthorized({
        message: 'You are not the owner of this list',
      })
    }

    if (backdropMode === 'image') {
      if (user.plan === 'free') {
        return response.unauthorized({
          message: 'You must be a Plus user to use an image as backdrop for a list',
        })
      }
    }

    if (backdropMode === 'color') {
      list.merge({ backdropImage: null })
    }

    await list
      .merge({
        name,
        description,
        tags,
        isPublic,
        backdropMode,
        backdropColor,
        ranked,
      })
      .save()

    const updatedList = (
      await List.query().where('id', id).preload('user').preload('bookItems').first()
    )?.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })

    return response.ok(updatedList)
  }

  /**
   * @summary Delete list
   * @tag Lists
   * @description Deletes a list. Only the owner can delete their lists
   * @paramPath id - List ID - @type(number) @required
   * @responseBody 204 - List deleted successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List not found
   */
  public async delete({ request, auth, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(deleteSchema)
    const { id } = payload.params
    const list = await List.findOrFail(id)

    if (list.userId !== user.id) {
      return response.unauthorized({
        message: 'You are not the owner of this list',
      })
    }

    await list.delete()

    return response.noContent()
  }

  /**
   * @summary Add book to list
   * @tag Lists
   * @description Adds a book to the specified list. Only the owner can add books to their lists
   * @paramPath id - List ID - @type(number) @required
   * @requestBody <addBookSchema> - Book addition data
   * @responseBody 200 - {"message": "string", "item_number": "number"} - Book added successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List or book not found
   * @responseBody 409 - Book already in list
   * @responseBody 422 - Validation error
   */
  public async addBook({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(addBookSchema)
    const { id } = payload.params
    const { bookId } = payload

    const list = await List.findOrFail(id)

    if (list.userId !== user.id) {
      return response.unauthorized({
        message: 'You are not the owner of this list',
      })
    }

    const book = await Book.findOrFail(bookId)

    // Check if book is already in the list
    const existingRelation = await list
      .related('bookItems')
      .query()
      .where('book_id', bookId)
      .first()
    if (existingRelation) {
      return response.conflict({
        message: 'Book is already in this list',
      })
    }

    // Get the current count of books in the list to determine the next item_number
    const currentCount = await list.related('bookItems').query().count('* as total')
    const nextItemNumber = currentCount[0].$extras.total || 0

    // Add the book with the calculated item_number
    await list.related('bookItems').attach({
      [book.id]: {
        item_number: nextItemNumber,
        added_at: new Date(),
        updated_at: new Date(),
      },
    })

    return response.ok({
      message: 'Book added to list',
      item_number: nextItemNumber,
    })
  }

  /**
   * @summary Remove book from list
   * @tag Lists
   * @description Removes a book from the specified list. Only the owner can remove books from their lists
   * @paramPath id - List ID - @type(number) @required
   * @requestBody <removeBookSchema> - Book removal data
   * @responseBody 204 - Book removed successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List or book not found
   * @responseBody 422 - Validation error
   */
  public async removeBook({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(removeBookSchema)
    const { id } = payload.params
    const { bookId } = payload

    const list = await List.findOrFail(id)

    if (list.userId !== user.id) {
      return response.unauthorized({
        message: 'You are not the owner of this list',
      })
    }

    // Get the item_number of the book to delete
    const listBookEntry = await db
      .from('list_books')
      .where('list_id', id)
      .where('book_id', bookId)
      .first()

    if (!listBookEntry) {
      return response.notFound({
        message: 'Book not found in this list',
      })
    }

    await list.related('bookItems').detach([bookId])

    // Update the item_number of the remaining books
    await db.rawQuery(
      'UPDATE list_books SET item_number = item_number - 1 WHERE list_id = ? AND item_number > ?',
      [id, listBookEntry.item_number]
    )

    return response.noContent()
  }

  /**
   * @summary Reorder books in list
   * @tag Lists
   * @description Reorders books in the specified list. Only the owner can reorder their lists
   * @paramPath id - List ID - @type(number) @required
   * @requestBody <reorderListSchema> - Book reordering data
   * @responseBody 204 - Books reordered successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List or book not found
   * @responseBody 422 - Validation error
   */
  public async reorderList({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(reorderListSchema)
    const { id } = payload.params
    const { bookIds } = payload

    const list = await List.findOrFail(id)

    if (list.userId !== user.id) {
      return response.unauthorized({
        message: 'You are not the owner of this list',
      })
    }

    for (const [index, bookId] of bookIds.entries()) {
      const listBookEntry = await db
        .from('list_books')
        .where('list_id', id)
        .where('book_id', bookId)
        .first()
      if (!listBookEntry) {
        return response.notFound({
          message: `Book ID: ${bookId} not found in this list`,
        })
      }
      await db.rawQuery('UPDATE list_books SET item_number = ? WHERE list_id = ? AND book_id = ?', [
        index + 1,
        id,
        bookId,
      ])
    }

    return response.noContent()
  }

  /**
   * @summary Upload backdrop image for list
   * @tag Lists
   * @description Uploads a backdrop image for the specified list. Only the owner can upload images for their lists
   * @paramPath id - List ID - @type(number) @required
   * @requestFormDataBody <updateBackdropSchema> - Backdrop image file
   * @responseBody 200 - <List>.with(user) - Updated list with backdrop image
   * @responseBody 400 - Bad request (no image or invalid image)
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List not found
   */
  public async uploadBackdropImage({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { params, backdrop } = await request.validateUsing(updateBackdropSchema)
    const { id } = params

    const list = await List.findOrFail(id)

    if (list.userId !== user.id) {
      return response.unauthorized({
        message: 'You are not the owner of this list',
      })
    }

    if (user.plan === 'free') {
      return response.unauthorized({
        message: 'You must be a Plus user to upload an image for a list',
      })
    }

    if (!backdrop) {
      return response.badRequest({ message: 'No image provided' })
    }

    if (!backdrop.isValid) {
      return response.badRequest({ errors: backdrop.errors })
    }

    const key = `images/list/backdrop/${cuid()}.${backdrop.extname}`
    await backdrop.moveToDisk(key)

    await list.merge({ backdropImage: backdrop.meta.url }).save()

    return response.accepted({})
  }
}
