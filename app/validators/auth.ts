import vine from '@vinejs/vine'

export const registerSchema = vine.compile(
  vine.object({
    email: vine.string().email().trim(),
    username: vine.string().minLength(3).trim(),
    password: vine.string().minLength(8).trim(),
  })
)

export const loginSchema = vine.compile(
  vine.object({
    email: vine.string().email().trim(),
    password: vine.string().minLength(8).trim(),
  })
)
