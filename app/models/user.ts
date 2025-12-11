import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import {
  BaseModel,
  column,
  hasMany,
  beforeCreate,
  beforeSave,
  manyToMany,
} from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import type { HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import List from '#models/list'
import BookTracking from '#models/book_tracking'
import Book from './book.js'
import ContentFilterService from '#services/content_filter_service'
import AppError from '#exceptions/app_error'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignUuid(user: User) {
    user.id = randomUUID()
  }

  @beforeCreate()
  static assignRole(user: User) {
    user.role = 'user'
  }

  @beforeCreate()
  static assignPlan(user: User) {
    user.plan = 'free'
  }

  @column()
  declare username: string

  @column()
  declare displayName: string | null

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string | null

  @column()
  declare googleId: string | null

  @column()
  declare avatar: string | null

  @column({ serializeAs: null })
  declare role: 'admin' | 'user'

  @column()
  declare plan: 'free' | 'plus'

  @column()
  declare preferences: Record<string, any> | null

  @column()
  declare backdropMode: string

  @column()
  declare backdropColor: string

  @column()
  declare backdropImage: string | null

  // Subscription fields
  @column({ serializeAs: null })
  declare subscriptionId: string | null

  @column()
  declare subscriptionStatus: 'active' | 'cancelled' | 'expired' | 'billing_issue' | null

  @column.dateTime()
  declare subscriptionExpiresAt: DateTime | null

  @column()
  declare subscriptionPeriod: 'monthly' | 'yearly' | null

  // Chat request limits
  @column({ serializeAs: null })
  declare chatRequestsCount: number

  @column.dateTime({ serializeAs: null })
  declare chatRequestsResetAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => List)
  declare lists: HasMany<typeof List>

  @hasMany(() => BookTracking)
  declare bookTrackings: HasMany<typeof BookTracking>

  @manyToMany(() => Book, {
    pivotTable: 'users_top_books',
    pivotColumns: ['position', 'created_at', 'updated_at'],
    serializeAs: null,
  })
  declare topBooks: ManyToMany<typeof Book>

  static accessTokens = DbAccessTokensProvider.forModel(User, {
    expiresIn: '30 days',
    prefix: 'trk_',
  })

  /**
   * Check if user has an active Plus subscription
   */
  get isPremium(): boolean {
    if (this.plan !== 'plus') return false

    // If there's an expiration date, check if still valid
    if (this.subscriptionExpiresAt) {
      return DateTime.now() < this.subscriptionExpiresAt
    }

    // Admin-granted Plus without expiration
    return true
  }

  @beforeSave()
  static async validateContent(user: User) {
    // Validate username (reject if offensive)
    if (user.$dirty.username) {
      const usernameCheck = ContentFilterService.validateAndCensor(user.username, 'username', {
        autoReject: true,
        autoCensor: false,
      })
      if (!usernameCheck.isValid) {
        throw new AppError(
          'Username contains inappropriate content. Please choose a different username.',
          { status: 400, code: 'INVALID_USERNAME' }
        )
      }
    }

    // Validate and censor displayName
    if (user.$dirty.displayName && user.displayName) {
      const displayNameCheck = ContentFilterService.validateAndCensor(
        user.displayName,
        'display_name',
        { autoReject: false, autoCensor: true }
      )
      if (displayNameCheck.content !== user.displayName) {
        // Log the moderation if user already exists (update case)
        if (user.id) {
          await ContentFilterService.logModeration(
            user.id,
            'display_name',
            user.displayName,
            displayNameCheck.content,
            displayNameCheck.reason!
          )
        }
        user.displayName = displayNameCheck.content
      }
    }
  }
}
