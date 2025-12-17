import vine from '@vinejs/vine'

export const createReviewSchema = vine.compile(
  vine.object({
    params: vine.object({
      bookId: vine.number().positive(),
    }),
    content: vine.string().trim().minLength(1).maxLength(2000),
    isSpoiler: vine.boolean().optional(),
  })
)

export const updateReviewSchema = vine.compile(
  vine.object({
    params: vine.object({
      bookId: vine.number().positive(),
      id: vine.number().positive(),
    }),
    content: vine.string().trim().minLength(1).maxLength(2000),
    isSpoiler: vine.boolean().optional(),
  })
)

export const showReviewSchema = vine.compile(
  vine.object({
    params: vine.object({
      bookId: vine.number().positive(),
      id: vine.number().positive(),
    }),
  })
)

export const deleteReviewSchema = vine.compile(
  vine.object({
    params: vine.object({
      bookId: vine.number().positive(),
      id: vine.number().positive(),
    }),
  })
)

export const likeReviewSchema = vine.compile(
  vine.object({
    params: vine.object({
      bookId: vine.number().positive(),
      id: vine.number().positive(),
    }),
  })
)

export const indexReviewsSchema = vine.compile(
  vine.object({
    params: vine.object({
      bookId: vine.number().positive(),
    }),
    sort: vine.enum(['recent', 'popular', 'highest_rated', 'lowest_rated']).optional(),
    page: vine.number().positive().optional(),
  })
)

export const userReviewsSchema = vine.compile(
  vine.object({
    params: vine.object({
      username: vine.string(),
    }),
    page: vine.number().positive().optional(),
  })
)

export const myReviewSchema = vine.compile(
  vine.object({
    params: vine.object({
      bookId: vine.number().positive(),
    }),
  })
)
