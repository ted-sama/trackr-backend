import vine from '@vinejs/vine'

export const showSchema = vine.compile(
  vine.object({
    params: vine.object({
      username: vine.string().toLowerCase().trim(),
    }),
  })
)

export const updateSchema = vine.compile(
  vine.object({
    username: vine.string().trim().optional(),
    displayName: vine.string().trim().optional(),
    backdropMode: vine.string().trim().optional(),
    backdropColor: vine.string().trim().optional(),
  })
)

export const updateAvatarSchema = vine.compile(
  vine.object({
    avatar: vine.file({
      size: '10mb',
      extnames: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    }),
  })
)

export const updateBackdropSchema = vine.compile(
  vine.object({
    backdrop: vine.file({
      size: '10mb',
      extnames: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    }),
  })
)

export const showListsQuerySchema = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    limit: vine.number().positive().max(100).optional(),
    sort: vine.enum(['created_at', 'name'] as const).optional(),
    order: vine.enum(['asc', 'desc'] as const).optional(),
    q: vine.string().trim().optional(),
  })
)
