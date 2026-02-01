import vine from '@vinejs/vine'

export const indexCommentsSchema = vine.compile(
  vine.object({
    params: vine.object({
      reviewId: vine.number().positive(),
    }),
    page: vine.number().positive().optional(),
  })
)

export const createCommentSchema = vine.compile(
  vine.object({
    params: vine.object({
      reviewId: vine.number().positive(),
    }),
    content: vine.string().trim().minLength(1).maxLength(1000),
    parentId: vine.string().uuid().optional(),
    mentions: vine.array(vine.string().uuid()).optional(),
  })
)

export const updateCommentSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.string().uuid(),
    }),
    content: vine.string().trim().minLength(1).maxLength(1000),
  })
)

export const deleteCommentSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.string().uuid(),
    }),
  })
)

export const toggleLikeCommentSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.string().uuid(),
    }),
  })
)
