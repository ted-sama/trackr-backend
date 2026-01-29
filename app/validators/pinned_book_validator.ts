import { vine } from '#validators/vine'

export const pinBookValidator = vine.compile(
  vine.object({
    bookId: vine.number().exists(async (db, value) => {
      const book = await db.from('books').where('id', value).first()
      return !!book
    }),
  })
)

export const updatePinnedBookValidator = vine.compile(
  vine.object({
    summary: vine.string().maxLength(2000).optional(),
  })
)
