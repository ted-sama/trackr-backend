import vine from '@vinejs/vine'

/**
 * Validator for MAL XML file upload
 */
export const malImportValidator = vine.compile(
  vine.object({
    file: vine.file({
      size: '10mb',
      extnames: ['xml', 'gz'],
    }),
  })
)

/**
 * Validator for MAL username import
 */
export const malUsernameImportValidator = vine.compile(
  vine.object({
    username: vine.string().trim().minLength(2).maxLength(16),
  })
)

/**
 * Validator for Mangacollec username or profile URL
 */
export const mangacollecUsernameImportValidator = vine.compile(
  vine.object({
    username: vine.string().trim().minLength(2).maxLength(200),
  })
)
