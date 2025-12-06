import User from '#models/user'
import AppError from '#exceptions/app_error'
import type { HttpContext } from '@adonisjs/core/http'
import mail from '@adonisjs/mail/services/main'
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '#validators/auth'
import PasswordResetToken from '#models/password_reset_token'
import { DateTime } from 'luxon'
import { randomBytes } from 'node:crypto'

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

    await mail.send((message) => {
      message.from('noreply@email.trackrr.app', 'Trackr')
      message.to('teddynsoki@gmail.com')
      message.subject('Welcome to Trackr')
      message.html(`<p>Welcome to Trackr, ${user.displayName}!</p>`)
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

  /**
   * @summary Request password reset
   * @tag Authentication
   * @description Sends a password reset email to the user
   * @requestBody <forgotPasswordSchema> - User email
   * @responseBody 200 - {"message": "If an account exists with that email, a password reset link has been sent"} - Success response
   * @responseBody 422 - Validation error
   */
  async forgotPassword({ request, response }: HttpContext) {
    const { email } = await forgotPasswordSchema.validate(request.body())

    const user = await User.findBy('email', email)

    // Always return success message to prevent user enumeration
    if (!user) {
      return response.ok({
        message: 'If an account exists with that email, a password reset link has been sent',
      })
    }

    // Delete any existing reset tokens for this user
    await PasswordResetToken.query().where('user_id', user.id).delete()

    // Generate a secure random token
    const token = randomBytes(32).toString('hex')

    // Create reset token that expires in 1 hour
    await PasswordResetToken.create({
      userId: user.id,
      token,
      expiresAt: DateTime.now().plus({ hours: 1 }),
    })

    // Send reset email
    await mail.send((message) => {
      message.from('noreply@email.trackrr.app', 'Trackr')
      message.to(user.email)
      message.subject('Reset your Trackr password')
      message.html(`
        <h1>Password Reset Request</h1>
        <p>Hello ${user.displayName || user.username},</p>
        <p>You requested to reset your password. Click the link below to reset it:</p>
        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}">Reset Password</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `)
    })

    return response.ok({
      message: 'If an account exists with that email, a password reset link has been sent',
    })
  }

  /**
   * @summary Reset password
   * @tag Authentication
   * @description Resets user password using a valid reset token
   * @requestBody <resetPasswordSchema> - Reset token and new password
   * @responseBody 200 - {"message": "Password has been reset successfully"} - Success response
   * @responseBody 400 - {"code": "AUTH_INVALID_TOKEN", "message": "Invalid or expired reset token"} - Invalid token
   * @responseBody 422 - Validation error
   */
  async resetPassword({ request, response }: HttpContext) {
    const { token, password } = await resetPasswordSchema.validate(request.body())

    const resetToken = await PasswordResetToken.query()
      .where('token', token)
      .preload('user')
      .first()

    if (!resetToken || resetToken.isExpired) {
      throw new AppError('Invalid or expired reset token', {
        status: 400,
        code: 'AUTH_INVALID_TOKEN',
      })
    }

    // Update user password
    const user = resetToken.user
    user.password = password
    await user.save()

    // Delete the used reset token
    await resetToken.delete()

    // Send confirmation email
    await mail.send((message) => {
      message.from('noreply@email.trackrr.app', 'Trackr')
      message.to(user.email)
      message.subject('Your Trackr password has been reset')
      message.html(`
        <h1>Password Reset Successful</h1>
        <p>Hello ${user.displayName || user.username},</p>
        <p>Your password has been reset successfully.</p>
        <p>If you didn't make this change, please contact support immediately.</p>
      `)
    })

    return response.ok({
      message: 'Password has been reset successfully',
    })
  }
}
