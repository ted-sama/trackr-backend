import User from '#models/user'
import hash from '@adonisjs/core/services/hash'
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
   * @responseBody 422 - User already exists
   */
  async register({ request, response }: HttpContext) {
    const { email, username, password } = await registerSchema.validate(request.body())

    const user = await User.create({
      email,
      username,
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
   * @responseBody 400 - Invalid credentials
   * @responseBody 422 - Validation error
   */
  async login({ request, response }: HttpContext) {
    const { email, password } = await loginSchema.validate(request.body())

    const user = await User.verifyCredentials(email, password)

    if (!user) {
      return response.abort('Invalid credentials')
    }

    const token = await User.accessTokens.create(user)

    return response.ok(token)
  }
}
