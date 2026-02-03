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
