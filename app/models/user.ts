import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import {
  BaseModel,
  column,
  computed,
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
import BookReview from '#models/book_review'
import Book from './book.js'
import ContentFilterService from '#services/content_filter_service'
import AppError from '#exceptions/app_error'

export interface NotificationPreferences {
  reviewLikes?: boolean
  listLikes?: boolean
  listSaves?: boolean
}

export interface UserPreferences {
  notifications?: NotificationPreferences
}

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

  @beforeCreate()
  static assignPrivacyDefaults(user: User) {
    user.isStatsPublic = true
    user.isActivityPublic = true
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
  declare preferences: UserPreferences | null

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

  // Privacy settings
  @column()
  declare isStatsPublic: boolean

  @column()
  declare isActivityPublic: boolean

  // Push notifications
  @column({ serializeAs: null })
  declare pushToken: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => List)
  declare lists: HasMany<typeof List>

  @hasMany(() => BookTracking)
  declare bookTrackings: HasMany<typeof BookTracking>

  @hasMany(() => BookReview)
  declare reviews: HasMany<typeof BookReview>

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
   * Check if user has a password (for email-based auth)
   * Google-only users don't have a password
   */
  @computed()
  get hasPassword(): boolean {
    return !!this.password
  }

  /**
   * Notification preferences helpers (default to true if not set)
   */
  get notifyReviewLikes(): boolean {
    return this.preferences?.notifications?.reviewLikes ?? true
  }

  get notifyListLikes(): boolean {
    return this.preferences?.notifications?.listLikes ?? true
  }

  get notifyListSaves(): boolean {
    return this.preferences?.notifications?.listSaves ?? true
  }

  /**
   * Get all notification preferences
   */
  getNotificationPreferences(): NotificationPreferences {
    return {
      reviewLikes: this.notifyReviewLikes,
      listLikes: this.notifyListLikes,
      listSaves: this.notifyListSaves,
    }
  }

  /**
   * Update notification preferences
   */
  setNotificationPreferences(prefs: Partial<NotificationPreferences>) {
    this.preferences = {
      ...this.preferences,
      notifications: {
        ...this.preferences?.notifications,
        ...prefs,
      },
    }
  }

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
