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

    if (list.isPublic || list.userId === user.id) {
      return response.ok(list)
    }

    return response.unauthorized({
      message: 'You are not authorized to view this list',
    })
  }

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

  public async create({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { name, description, tags, isPublic, backdropImage, ranked } =
      await request.validateUsing(createSchema)
    const list = (
      await List.create({
        name,
        description,
        tags,
        isPublic,
        backdropImage,
        ranked,
        userId: user.id,
      })
    ).serialize({
      relations: {
        owner: {
          fields: {
            pick: ['id', 'username', 'avatar', 'plan'],
          },
        },
      },
    })
    return response.ok(list)
  }

  public async update({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const payload = await request.validateUsing(updateSchema)
    const { name, description, tags, isPublic, backdropImage, ranked } = payload
    const { id } = payload.params

    const list = await List.findOrFail(id)

    if (list.userId !== user.id) {
      return response.unauthorized({
        message: 'You are not the owner of this list',
      })
    }

    await list.merge({ name, description, tags, isPublic, backdropImage, ranked }).save()

    return response.ok(
      list.serialize({
        relations: {
          owner: {
            fields: {
              pick: ['id', 'username', 'avatar', 'plan'],
            },
          },
        },
      })
    )
  }

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

    if (!backdrop) {
      return response.badRequest({ message: 'No image provided' })
    }

    if (!backdrop.isValid) {
      return response.badRequest({ errors: backdrop.errors })
    }

    const key = `uploads/lists/${cuid()}.${backdrop.extname}`
    await backdrop.moveToDisk(key)

    await list.merge({ backdropImage: backdrop.meta.url }).save()

    return response.ok(
      list.serialize({
        relations: {
          owner: {
            fields: {
              pick: ['id', 'username', 'avatar', 'plan'],
            },
          },
        },
      })
    )
  }
}
