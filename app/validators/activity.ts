import vine from '@vinejs/vine'

/**
 * Validator for activity list query parameters
 */
export const activityFiltersSchema = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    limit: vine.number().positive().max(50).optional(),
    sort: vine.enum(['recent', 'oldest']).optional(),
    period: vine.enum(['today', 'week', 'month', 'year', 'all']).optional(),
    actions: vine.array(vine.string()).optional(),
  })
)

/**
 * Valid action types for activity logs
 */
export const VALID_ACTION_TYPES = [
  'book.addedToLibrary',
  'book.removedFromLibrary',
  'book.addedToFavorites',
  'book.removedFromFavorites',
  'book.statusUpdated',
  'book.currentChapterUpdated',
  'book.ratingUpdated',
  'book.reviewCreated',
  'book.reviewUpdated',
  'book.reviewDeleted',
] as const

export type ActivitySort = 'recent' | 'oldest'
export type ActivityPeriod = 'today' | 'week' | 'month' | 'year' | 'all'
export type ActivityActionType = (typeof VALID_ACTION_TYPES)[number]
