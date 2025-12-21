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

export const forgotPasswordSchema = vine.compile(
  vine.object({
    email: vine.string().email().trim(),
  })
)

export const resetPasswordSchema = vine.compile(
  vine.object({
    token: vine.string().trim(),
    password: vine.string().minLength(8).trim(),
  })
)

export const googleCallbackSchema = vine.compile(
  vine.object({
    idToken: vine.string().trim(),
  })
)

export const checkEmailSchema = vine.compile(
  vine.object({
    email: vine.string().email().trim(),
  })
)
