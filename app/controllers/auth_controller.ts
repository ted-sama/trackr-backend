import User from '#models/user'
import hash from '@adonisjs/core/services/hash'
import type { HttpContext } from '@adonisjs/core/http'
import { loginSchema, registerSchema } from '#validators/auth'

export default class AuthController {
  async register({ request, response }: HttpContext) {
    const { email, username, password } = await registerSchema.validate(request.body())

    const user = await User.create({
      email,
      username,
      password,
    })

    return response.ok(user)
  }

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
