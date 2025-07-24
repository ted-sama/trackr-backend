import vine from '@vinejs/vine'

export const updateLibraryValidator = vine.compile(
  vine.object({
    rating: vine.number().min(0).max(5).optional(),
    notes: vine.string().optional(),
    status: vine.enum(['plan_to_read', 'reading', 'completed', 'on_hold', 'dropped']).optional(),
    currentChapter: vine.number().min(0).optional(),
    currentVolume: vine.number().min(0).optional(),
  })
)
