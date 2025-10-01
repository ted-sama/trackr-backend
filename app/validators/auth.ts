import vine from '@vinejs/vine'

export const registerSchema = vine.compile(
  vine.object({
    email: vine.string().email().trim(),
    displayName: vine.string().trim(),
    username: vine.string().toLowerCase().trim().minLength(3),
    password: vine.string().minLength(8).trim(),
  })
)

export const loginSchema = vine.compile(
  vine.object({
    email: vine.string().email().trim(),
    password: vine.string().minLength(8).trim(),
  })
)
