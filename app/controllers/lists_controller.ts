import Book from '#models/book'
import List from '#models/list'
import AppError from '#exceptions/app_error'
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
  likeSchema,
  saveListSchema,
} from '#validators/list'
import type { HttpContext } from '@adonisjs/core/http'
import { cuid } from '@adonisjs/core/helpers'

function enrichListWithUserContext(list: any, lists: List[], userId: string | null) {
  const listModel = lists.find((l) => l.id === list.id)
  if (listModel && userId) {
    list.isLikedByMe = listModel.isLikedBy(userId)
    list.isSavedByMe = listModel.isSavedBy(userId)
  } else {
    list.isLikedByMe = false
    list.isSavedByMe = false
  }
  return list
}

export default class ListsController {
  /**
   * @summary Get public lists
   * @tag Lists
   * @description Returns a paginated list of public lists (excluding My Library lists), sorted by likes count by default
   * @paramQuery page - Page number for pagination - @type(number)
   * @paramQuery limit - Number of items per page - @type(number)
   * @responseBody 200 - <List[]>.with(user, bookItems).paginated() - List of public lists
   * @responseBody 400 - Bad request
   */
  public async index({ auth, request, response }: HttpContext) {
    const { page = 1, limit = 10 } = request.qs()
    const user = auth.user ?? null

    const listsQuery = await List.query()
      .where('is_my_library', false)
      .where('is_public', true)
      .select('lists.*')
      .select(
        db
          .from('list_likes')
          .whereColumn('list_likes.list_id', 'lists.id')
          .count('*')
          .as('likes_count')
      )
      .preload('user')
      .preload('bookItems')
      .preload('likedBy')
      .preload('savedBy')
      .orderBy('likes_count', 'desc')
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    const serializedLists = listsQuery.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    serializedLists.data = serializedLists.data.map((list: any) =>
      enrichListWithUserContext(list, listsQuery.all(), user?.id ?? null)
    )

    return response.ok(serializedLists)
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
  public async search({ auth, request, response }: HttpContext) {
    const page = request.input('page', 1)
    const limit = request.input('limit', 20)
    const query = request.input('q')
    const user = auth.user ?? null

    if (!query) {
      throw new AppError('Search query is required', {
        status: 400,
        code: 'LIST_SEARCH_QUERY_MISSING',
      })
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
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(tags::jsonb, '[]'::jsonb)) AS tag
            WHERE LOWER(tag) = ?
          ) THEN 75
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(tags::jsonb, '[]'::jsonb)) AS tag
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
          .orWhereRaw(
            `EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(COALESCE(tags::jsonb, '[]'::jsonb)) AS tag
              WHERE LOWER(tag) = ?
            )`,
            [normalizedQuery]
          )
          .orWhereRaw(
            `EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(COALESCE(tags::jsonb, '[]'::jsonb)) AS tag
              WHERE LOWER(tag) LIKE ?
            )`,
            [`%${normalizedQuery}%`]
          )
          .orWhereILike('search_text', `%${normalizedQuery}%`)
      })
      .where('is_my_library', false)
      .where('is_public', true)
      .preload('user')
      .preload('bookItems', (bookItemsQuery) => {
        bookItemsQuery.preload('authors')
      })
      .preload('likedBy')
      .preload('savedBy')
      .orderBy('relevance_score', 'desc')
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    const serializedLists = lists.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    serializedLists.data = serializedLists.data.map((list: any) =>
      enrichListWithUserContext(list, lists.all(), user?.id ?? null)
    )

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
    const listModel = await List.query()
      .where('is_my_library', false)
      .where('id', id)
      .preload('user')
      .preload('bookItems', (bookItemsQuery) => {
        bookItemsQuery.preload('authors')
      })
      .preload('likedBy')
      .preload('savedBy')
      .first()

    if (!listModel) {
      throw new AppError('List not found', {
        status: 404,
        code: 'LIST_NOT_FOUND',
      })
    }

    if (!listModel.isPublic && listModel.userId !== user.id) {
      throw new AppError('You are not authorized to view this list', {
        status: 401,
        code: 'LIST_VIEW_FORBIDDEN',
      })
    }

    const list = listModel.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    const enrichedList = enrichListWithUserContext(list, [listModel], user.id)

    return response.ok(enrichedList)
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
  public async indexByUser({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(indexByUserSchema)
    const { userId } = payload.params
    const { page = 1, limit = 10 } = request.qs()
    const user = auth.user ?? null

    const listsQuery = await List.query()
      .where('user_id', userId)
      .where('is_my_library', false)
      .where('is_public', true)
      .preload('user')
      .preload('bookItems', (bookItemsQuery) => {
        bookItemsQuery.preload('authors')
      })
      .preload('likedBy')
      .preload('savedBy')
      .paginate(page, limit)

    const serializedLists = listsQuery.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
          },
        },
      },
    })

    serializedLists.data = serializedLists.data.map((list: any) =>
      enrichListWithUserContext(list, listsQuery.all(), user?.id ?? null)
    )

    return response.ok(serializedLists)
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
      await List.query()
        .where('id', list.id)
        .preload('user')
        .preload('bookItems', (bookItemsQuery) => {
          bookItemsQuery.preload('authors')
        })
        .first()
    )?.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
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
      throw new AppError('You are not the owner of this list', {
        status: 401,
        code: 'LIST_NOT_OWNER',
      })
    }

    if (backdropMode === 'image') {
      if (user.plan === 'free') {
        throw new AppError('You must be a Plus user to use an image as backdrop for a list', {
          status: 401,
          code: 'LIST_PLUS_REQUIRED',
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
      await List.query()
        .where('id', id)
        .preload('user')
        .preload('bookItems', (bookItemsQuery) => {
          bookItemsQuery.preload('authors')
        })
        .first()
    )?.serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'displayName', 'avatar', 'plan'],
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
      throw new AppError('You are not the owner of this list', {
        status: 401,
        code: 'LIST_NOT_OWNER',
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
      throw new AppError('You are not the owner of this list', {
        status: 401,
        code: 'LIST_NOT_OWNER',
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
      throw new AppError('Book is already in this list', {
        status: 409,
        code: 'LIST_BOOK_ALREADY_EXISTS',
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
      throw new AppError('Book not found in this list', {
        status: 404,
        code: 'LIST_BOOK_NOT_FOUND',
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
      throw new AppError('You are not the owner of this list', {
        status: 401,
        code: 'LIST_NOT_OWNER',
      })
    }

    for (const [index, bookId] of bookIds.entries()) {
      const listBookEntry = await db
        .from('list_books')
        .where('list_id', id)
        .where('book_id', bookId)
        .first()
      if (!listBookEntry) {
        throw new AppError(`Book ID: ${bookId} not found in this list`, {
          status: 404,
          code: 'LIST_BOOK_NOT_FOUND',
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
      throw new AppError('You are not the owner of this list', {
        status: 401,
        code: 'LIST_NOT_OWNER',
      })
    }

    if (user.plan === 'free') {
      throw new AppError('You must be a Plus user to upload an image for a list', {
        status: 401,
        code: 'LIST_PREMIUM_REQUIRED',
      })
    }

    if (!backdrop) {
      throw new AppError('No image provided', {
        status: 400,
        code: 'LIST_BACKDROP_MISSING',
      })
    }

    if (!backdrop.isValid) {
      throw new AppError('Invalid image upload', {
        status: 400,
        code: 'LIST_BACKDROP_INVALID',
      })
    }

    const key = `images/list/backdrop/${cuid()}.${backdrop.extname}`
    await backdrop.moveToDisk(key)

    await list.merge({ backdropImage: backdrop.meta.url }).save()

    return response.accepted({})
  }

  /**
   * @summary Like a list
   * @tag Lists
   * @description Adds a like to the specified list
   * @paramPath id - List ID - @type(number) @required
   * @responseBody 200 - {"message": "string"} - List liked successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List not found
   * @responseBody 409 - List already liked
   */
  public async like({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(likeSchema)
    const { id } = payload.params

    const list = await List.findOrFail(id)

    if (!list.isPublic) {
      throw new AppError('You can only like public lists', {
        status: 401,
        code: 'LIST_LIKE_PRIVATE_FORBIDDEN',
      })
    }

    const existingLike = await db
      .from('list_likes')
      .where('list_id', id)
      .where('user_id', user.id)
      .first()

    if (existingLike) {
      throw new AppError('You have already liked this list', {
        status: 409,
        code: 'LIST_ALREADY_LIKED',
      })
    }

    await list.related('likedBy').attach([user.id])

    return response.ok({
      message: 'List liked successfully',
    })
  }

  /**
   * @summary Unlike a list
   * @tag Lists
   * @description Removes a like from the specified list
   * @paramPath id - List ID - @type(number) @required
   * @responseBody 204 - Like removed successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List not found or like not found
   */
  public async unlike({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(likeSchema)
    const { id } = payload.params

    const list = await List.findOrFail(id)

    const existingLike = await db
      .from('list_likes')
      .where('list_id', id)
      .where('user_id', user.id)
      .first()

    if (!existingLike) {
      throw new AppError('You have not liked this list', {
        status: 404,
        code: 'LIST_LIKE_NOT_FOUND',
      })
    }

    await list.related('likedBy').detach([user.id])

    return response.noContent()
  }

  /**
   * @summary Save a list
   * @tag Lists
   * @description Adds another user's list to your saved lists
   * @paramPath id - List ID - @type(number) @required
   * @responseBody 200 - {"message": "string"} - List saved successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List not found
   * @responseBody 409 - List already saved
   */
  public async saveList({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(saveListSchema)
    const { id } = payload.params

    const list = await List.findOrFail(id)

    if (list.userId === user.id) {
      throw new AppError('You cannot save your own list', {
        status: 409,
        code: 'LIST_SAVE_OWN_FORBIDDEN',
      })
    }

    if (!list.isPublic) {
      throw new AppError('You can only save public lists', {
        status: 401,
        code: 'LIST_SAVE_PRIVATE_FORBIDDEN',
      })
    }

    const existingSave = await db
      .from('user_saved_lists')
      .where('user_id', user.id)
      .where('list_id', id)
      .first()

    if (existingSave) {
      throw new AppError('You have already saved this list', {
        status: 409,
        code: 'LIST_ALREADY_SAVED',
      })
    }

    await list.related('savedBy').attach([user.id])

    return response.ok({
      message: 'List saved successfully',
    })
  }

  /**
   * @summary Unsave a list
   * @tag Lists
   * @description Removes a list from your saved lists
   * @paramPath id - List ID - @type(number) @required
   * @responseBody 204 - List unsaved successfully
   * @responseBody 401 - Unauthorized
   * @responseBody 404 - List not found or save not found
   */
  public async unsaveList({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(saveListSchema)
    const { id } = payload.params

    const list = await List.findOrFail(id)

    const existingSave = await db
      .from('user_saved_lists')
      .where('user_id', user.id)
      .where('list_id', id)
      .first()

    if (!existingSave) {
      throw new AppError('You have not saved this list', {
        status: 404,
        code: 'LIST_SAVE_NOT_FOUND',
      })
    }

    await list.related('savedBy').detach([user.id])

    return response.noContent()
  }
}
