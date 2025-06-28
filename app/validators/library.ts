import vine from '@vinejs/vine'

export const updateLibraryValidator = vine.compile(
  vine.object({
    rating: vine.number().min(0).max(5).optional(),
    notes: vine.string().optional(),
    reading_status: vine.string().optional(),
    current_chapter: vine.number().optional(),
  })
)
