import User from '#models/user'
import AppError from '#exceptions/app_error'
import type { HttpContext } from '@adonisjs/core/http'
import { loginSchema, registerSchema } from '#validators/auth'

export default class AuthController {
  /**
   * @summary Register a new user
   * @tag Authentication
   * @description Creates a new user account with email, username, and password
   * @requestBody <registerSchema> - User registration data
   * @responseBody 200 - <User>.exclude(password) - Successfully registered user
   * @responseBody 400 - Validation error
   * @responseBody 409 - {"code": "AUTH_USER_ALREADY_EXISTS", "message": "User already exists"} - User already exists
   */
  async register({ request, response }: HttpContext) {
    const { email, username, displayName, password } = await registerSchema.validate(request.body())

    const existingUserByEmail = await User.findBy('email', email)
    const existingUserByUsername = await User.findBy('username', username)

    if (existingUserByEmail) {
      throw new AppError('Email already used', {
        status: 409,
        code: 'AUTH_EMAIL_ALREADY_USED',
      })
    }

    if (existingUserByUsername) {
      throw new AppError('Username already used', {
        status: 409,
        code: 'AUTH_USERNAME_TAKEN',
      })
    }

    if (username.trim().includes(' ')) {
      throw new AppError('Username cannot contain spaces', {
        status: 400,
        code: 'USER_USERNAME_INVALID',
      })
    }

    const user = await User.create({
      email,
      username,
      displayName,
      password,
    })

    return response.ok(user)
  }

  /**
   * @summary Login user
   * @tag Authentication
   * @description Authenticates user with email and password, returns access token
   * @requestBody <loginSchema> - User login credentials
   * @responseBody 200 - {"type": "bearer", "name": "trk_", "token": "string", "abilities": ["*"], "lastUsedAt": "string", "expiresAt": "string"} - Authentication token
   * @responseBody 400 - {"code": "AUTH_INVALID_CREDENTIALS", "message": "Invalid credentials"} - Invalid credentials
   * @responseBody 422 - Validation error
   */
  async login({ request, response }: HttpContext) {
    const { email, password } = await loginSchema.validate(request.body())

    const user = await User.verifyCredentials(email, password)

    if (!user) {
      throw new AppError('Invalid credentials', {
        status: 400,
        code: 'AUTH_INVALID_CREDENTIALS',
      })
    }

    const token = await User.accessTokens.create(user)

    return response.ok(token)
  }
}
