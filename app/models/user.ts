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
  newFollower?: boolean
  newFriend?: boolean
}

export type VisibilityLevel = 'public' | 'followers' | 'friends' | 'private'

export interface PrivacyPreferences {
  // Legacy boolean fields (for backward compatibility)
  statsPublic?: boolean
  activityPublic?: boolean
  libraryPublic?: boolean
  // New granular visibility fields
  statsVisibility?: VisibilityLevel
  activityVisibility?: VisibilityLevel
  libraryVisibility?: VisibilityLevel
  connectionsVisibility?: VisibilityLevel
}

export interface UserPreferences {
  notifications?: NotificationPreferences
  privacy?: PrivacyPreferences
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


  @column()
  declare username: string

  @column()
  declare displayName: string | null

  @column()
  declare bio: string | null

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

  @manyToMany(() => User, {
    pivotTable: 'user_follows',
    pivotForeignKey: 'follower_id',
    pivotRelatedForeignKey: 'following_id',
    pivotTimestamps: { createdAt: 'created_at', updatedAt: false },
    serializeAs: null,
  })
  declare following: ManyToMany<typeof User>

  @manyToMany(() => User, {
    pivotTable: 'user_follows',
    pivotForeignKey: 'following_id',
    pivotRelatedForeignKey: 'follower_id',
    pivotTimestamps: { createdAt: 'created_at', updatedAt: false },
    serializeAs: null,
  })
  declare followers: ManyToMany<typeof User>

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

  get notifyNewFollower(): boolean {
    return this.preferences?.notifications?.newFollower ?? true
  }

  get notifyNewFriend(): boolean {
    return this.preferences?.notifications?.newFriend ?? true
  }

  /**
   * Get all notification preferences
   */
  getNotificationPreferences(): NotificationPreferences {
    return {
      reviewLikes: this.notifyReviewLikes,
      listLikes: this.notifyListLikes,
      listSaves: this.notifyListSaves,
      newFollower: this.notifyNewFollower,
      newFriend: this.notifyNewFriend,
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
   * Privacy preferences helpers (default to true if not set)
   * Legacy boolean getters for backward compatibility
   */
  @computed()
  get isStatsPublic(): boolean {
    return this.preferences?.privacy?.statsPublic ?? true
  }

  @computed()
  get isActivityPublic(): boolean {
    return this.preferences?.privacy?.activityPublic ?? true
  }

  @computed()
  get isLibraryPublic(): boolean {
    return this.preferences?.privacy?.libraryPublic ?? true
  }

  /**
   * New granular visibility getters with backward compatibility
   * Falls back to legacy boolean fields if new fields not set
   */
  @computed()
  get statsVisibility(): VisibilityLevel {
    if (this.preferences?.privacy?.statsVisibility) {
      return this.preferences.privacy.statsVisibility
    }
    // Backward compatibility: convert boolean to visibility level
    return this.isStatsPublic ? 'public' : 'private'
  }

  @computed()
  get activityVisibility(): VisibilityLevel {
    if (this.preferences?.privacy?.activityVisibility) {
      return this.preferences.privacy.activityVisibility
    }
    return this.isActivityPublic ? 'public' : 'private'
  }

  @computed()
  get libraryVisibility(): VisibilityLevel {
    if (this.preferences?.privacy?.libraryVisibility) {
      return this.preferences.privacy.libraryVisibility
    }
    return this.isLibraryPublic ? 'public' : 'private'
  }

  @computed()
  get connectionsVisibility(): VisibilityLevel {
    return this.preferences?.privacy?.connectionsVisibility ?? 'public'
  }

  /**
   * Get all privacy preferences (returns both legacy and new format)
   */
  getPrivacyPreferences(): PrivacyPreferences {
    return {
      // Legacy format for backward compatibility
      statsPublic: this.isStatsPublic,
      activityPublic: this.isActivityPublic,
      libraryPublic: this.isLibraryPublic,
      // New granular format
      statsVisibility: this.statsVisibility,
      activityVisibility: this.activityVisibility,
      libraryVisibility: this.libraryVisibility,
      connectionsVisibility: this.connectionsVisibility,
    }
  }

  /**
   * Update privacy preferences
   */
  setPrivacyPreferences(prefs: Partial<PrivacyPreferences>) {
    this.preferences = {
      ...this.preferences,
      privacy: {
        ...this.preferences?.privacy,
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

    // Validate and censor bio
    if (user.$dirty.bio && user.bio) {
      const bioCheck = ContentFilterService.validateAndCensor(user.bio, 'bio', {
        autoReject: false,
        autoCensor: true,
      })
      if (bioCheck.content !== user.bio) {
        if (user.id) {
          await ContentFilterService.logModeration(
            user.id,
            'bio',
            user.bio,
            bioCheck.content,
            bioCheck.reason!
          )
        }
        user.bio = bioCheck.content
      }
    }
  }
}
