import vine from '@vinejs/vine'

export const showSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
  })
)

export const indexByUserSchema = vine.compile(
  vine.object({
    params: vine.object({
      userId: vine.string().uuid(),
    }),
  })
)

export const createSchema = vine.compile(
  vine.object({
    name: vine.string().trim(),
    description: vine.string().trim().optional(),
    tags: vine.array(vine.string().trim()).optional(),
    isPublic: vine.boolean().optional(),
    backdropImage: vine.string().trim().optional(),
    ranked: vine.boolean().optional(),
  })
)

export const updateSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
    name: vine.string().trim().optional(),
    description: vine.string().trim().optional(),
    tags: vine.array(vine.string().trim()).optional(),
    isPublic: vine.boolean().optional(),
    backdropImage: vine.string().trim().optional(),
    ranked: vine.boolean().optional(),
  })
)

export const deleteSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
  })
)

export const addBookSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
    bookId: vine.number().positive(),
  })
)

export const removeBookSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
    bookId: vine.number().positive(),
  })
)

export const reorderListSchema = vine.compile(
  vine.object({
    params: vine.object({
      id: vine.number().positive(),
    }),
    bookIds: vine.array(vine.number().positive()),
  })
)

export const updateBackdropSchema = vine.compile(
  vine.object({
    backdrop: vine.file({
      size: '10mb',
      extnames: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    }),
    params: vine.object({
      id: vine.number().positive(),
    }),
  })
)
