import User from '#models/user'
import AppError from '#exceptions/app_error'
import type { HttpContext } from '@adonisjs/core/http'
import mail from '@adonisjs/mail/services/main'
import hash from '@adonisjs/core/services/hash'
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  checkEmailSchema,
  refreshTokenSchema,
} from '#validators/auth'
import PasswordResetToken from '#models/password_reset_token'
import RefreshToken from '#models/refresh_token'
import { DateTime } from 'luxon'
import { randomBytes } from 'node:crypto'

/** Duration for refresh tokens in days */
const REFRESH_TOKEN_EXPIRY_DAYS = 90

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
    const data = await registerSchema.validate(request.body())
    const email = data.email.toLowerCase()
    const { username, displayName, password } = data

    const existingUserByEmail = await User.query().whereRaw('LOWER(email) = ?', [email]).first()
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
   * @description Authenticates user with email and password, returns access token and refresh token
   * @requestBody <loginSchema> - User login credentials
   * @responseBody 200 - {"token": "string", "refreshToken": "string", "expiresAt": "string"} - Authentication tokens
   * @responseBody 400 - {"code": "AUTH_INVALID_CREDENTIALS", "message": "Invalid credentials"} - Invalid credentials
   * @responseBody 422 - Validation error
   */
  async login({ request, response }: HttpContext) {
    const data = await loginSchema.validate(request.body())
    const email = data.email.toLowerCase()
    const { password } = data

    // Find user with case-insensitive email search
    const user = await User.query().whereRaw('LOWER(email) = ?', [email]).first()

    if (!user || !user.password) {
      throw new AppError('Invalid credentials', {
        status: 400,
        code: 'AUTH_INVALID_CREDENTIALS',
      })
    }

    // Verify password
    const isPasswordValid = await hash.verify(user.password, password)
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', {
        status: 400,
        code: 'AUTH_INVALID_CREDENTIALS',
      })
    }

    // Generate access token
    const accessToken = await User.accessTokens.create(user)

    // Generate refresh token
    const { rawToken: refreshToken } = await RefreshToken.generateForUser(
      user,
      REFRESH_TOKEN_EXPIRY_DAYS
    )

    return response.ok({
      token: accessToken.value!.release(),
      refreshToken,
      expiresAt: accessToken.expiresAt?.toISOString(),
    })
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
    const data = await forgotPasswordSchema.validate(request.body())
    const email = data.email.toLowerCase()

    const user = await User.query().whereRaw('LOWER(email) = ?', [email]).first()

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

  /**
   * @summary Change password
   * @tag Authentication
   * @description Changes the authenticated user's password
   * @requestBody <changePasswordSchema> - Current and new password
   * @responseBody 200 - {"message": "Password has been changed successfully"} - Success response
   * @responseBody 400 - {"code": "AUTH_NO_PASSWORD", "message": "Cannot change password for OAuth-only accounts"} - No password
   * @responseBody 400 - {"code": "AUTH_INVALID_CURRENT_PASSWORD", "message": "Current password is incorrect"} - Invalid current password
   * @responseBody 401 - Unauthorized
   * @responseBody 422 - Validation error
   */
  async changePassword({ auth, request, response }: HttpContext) {
    const user = await auth.authenticate()
    const { currentPassword, newPassword } = await changePasswordSchema.validate(request.body())

    // Check if user has a password (not OAuth-only)
    if (!user.password) {
      throw new AppError('Cannot change password for OAuth-only accounts', {
        status: 400,
        code: 'AUTH_NO_PASSWORD',
      })
    }

    // Verify current password
    const isCurrentPasswordValid = await hash.verify(user.password, currentPassword)
    if (!isCurrentPasswordValid) {
      throw new AppError('Current password is incorrect', {
        status: 400,
        code: 'AUTH_INVALID_CURRENT_PASSWORD',
      })
    }

    // Update password
    user.password = newPassword
    await user.save()

    return response.ok({
      message: 'Password has been changed successfully',
    })
  }

  /**
   * @summary Check if email exists
   * @tag Authentication
   * @description Checks if an account exists with the given email
   * @requestBody <checkEmailSchema> - Email to check
   * @responseBody 200 - {"exists": true} - Email exists
   * @responseBody 200 - {"exists": false} - Email does not exist
   * @responseBody 422 - Validation error
   */
  async checkEmail({ request, response }: HttpContext) {
    const data = await checkEmailSchema.validate(request.body())
    const email = data.email.toLowerCase()

    const existingUser = await User.query().whereRaw('LOWER(email) = ?', [email]).first()

    return response.ok({ exists: !!existingUser })
  }

  /**
   * @summary Redirect to Google OAuth
   * @tag Authentication
   * @description Redirects the user to Google for authentication
   */
  async googleRedirect({ ally }: HttpContext) {
    return ally.use('google').stateless().redirect()
  }

  /**
   * @summary Google OAuth callback
   * @tag Authentication
   * @description Handles the Google OAuth callback, creates or finds user, returns access token
   * @responseBody 200 - {"type": "bearer", "token": "string", "expiresAt": "string"} - Authentication token
   * @responseBody 400 - {"code": "AUTH_GOOGLE_CANCELLED", "message": "Google authentication was cancelled"} - User cancelled
   * @responseBody 400 - {"code": "AUTH_GOOGLE_DENIED", "message": "Access was denied"} - Access denied
   * @responseBody 400 - {"code": "AUTH_GOOGLE_FAILED", "message": "Google authentication failed"} - Authentication failed
   */
  async googleCallback({ ally, response }: HttpContext) {
    const google = ally.use('google').stateless()

    if (google.accessDenied()) {
      throw new AppError('Access was denied', {
        status: 400,
        code: 'AUTH_GOOGLE_DENIED',
      })
    }

    if (google.hasError()) {
      throw new AppError('Google authentication failed', {
        status: 400,
        code: 'AUTH_GOOGLE_FAILED',
      })
    }

    const googleUser = await google.user()
    const googleEmail = googleUser.email!.toLowerCase()

    // Find existing user by googleId or email (case-insensitive)
    let user = await User.query()
      .where('google_id', googleUser.id)
      .orWhereRaw('LOWER(email) = ?', [googleEmail])
      .first()

    if (user) {
      let needsSave = false

      // Link Google account if not already linked
      if (!user.googleId) {
        user.googleId = googleUser.id
        needsSave = true
      }

      // Normalize email to lowercase if needed
      if (user.email.toLowerCase() === googleEmail && user.email !== googleEmail) {
        user.email = googleEmail
        needsSave = true
      }

      // Update displayName from Google if empty
      if (!user.displayName && googleUser.name) {
        user.displayName = googleUser.name
        needsSave = true
      }

      // Update avatar from Google if empty
      if (!user.avatar && googleUser.avatarUrl) {
        user.avatar = googleUser.avatarUrl
        needsSave = true
      }

      if (needsSave) {
        await user.save()
      }
    } else {
      // Create new user
      const baseUsername = googleUser
        .email!.split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      let username = baseUsername
      let counter = 1

      // Ensure unique username
      while (await User.findBy('username', username)) {
        username = `${baseUsername}${counter}`
        counter++
      }

      user = await User.create({
        email: googleEmail,
        googleId: googleUser.id,
        displayName: googleUser.name,
        username,
        avatar: googleUser.avatarUrl,
      })

      await mail.send((message) => {
        message.from('noreply@email.trackrr.app', 'Trackr')
        message.to(user!.email)
        message.subject('Welcome to Trackr')
        message.html(`<p>Welcome to Trackr, ${user!.displayName}!</p>`)
      })
    }

    // Generate access token
    const accessToken = await User.accessTokens.create(user)

    // Generate refresh token
    const { rawToken: refreshToken } = await RefreshToken.generateForUser(
      user,
      REFRESH_TOKEN_EXPIRY_DAYS
    )

    // Redirect to mobile app with deep link containing both tokens
    const deepLinkUrl = `trackr://auth/callback?token=${accessToken.value!.release()}&refreshToken=${refreshToken}`
    return response.redirect(deepLinkUrl)
  }

  /**
   * @summary Refresh access token
   * @tag Authentication
   * @description Uses a refresh token to get a new access token
   * @requestBody <refreshTokenSchema> - Refresh token
   * @responseBody 200 - {"token": "string", "refreshToken": "string", "expiresAt": "string"} - New authentication tokens
   * @responseBody 401 - {"code": "AUTH_INVALID_REFRESH_TOKEN", "message": "Invalid or expired refresh token"} - Invalid refresh token
   */
  async refresh({ request, response }: HttpContext) {
    const { refreshToken: rawRefreshToken } = await refreshTokenSchema.validate(request.body())

    // Find valid refresh token
    const refreshToken = await RefreshToken.findByToken(rawRefreshToken)

    if (!refreshToken) {
      throw new AppError('Invalid or expired refresh token', {
        status: 401,
        code: 'AUTH_INVALID_REFRESH_TOKEN',
      })
    }

    // Load the user
    const user = await User.find(refreshToken.userId)

    if (!user) {
      // User was deleted, revoke the token
      await refreshToken.revoke()
      throw new AppError('Invalid or expired refresh token', {
        status: 401,
        code: 'AUTH_INVALID_REFRESH_TOKEN',
      })
    }

    // Revoke the old refresh token (rotation for security)
    await refreshToken.revoke()

    // Generate new access token
    const accessToken = await User.accessTokens.create(user)

    // Generate new refresh token
    const { rawToken: newRefreshToken } = await RefreshToken.generateForUser(
      user,
      REFRESH_TOKEN_EXPIRY_DAYS
    )

    return response.ok({
      token: accessToken.value!.release(),
      refreshToken: newRefreshToken,
      expiresAt: accessToken.expiresAt?.toISOString(),
    })
  }

  /**
   * @summary Logout user
   * @tag Authentication
   * @description Revokes all refresh tokens for the authenticated user
   * @responseBody 200 - {"message": "Logged out successfully"} - Success response
   * @responseBody 401 - Unauthorized
   */
  async logout({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    // Revoke all refresh tokens for this user
    await RefreshToken.revokeAllForUser(user.id)

    return response.ok({
      message: 'Logged out successfully',
    })
  }
}
