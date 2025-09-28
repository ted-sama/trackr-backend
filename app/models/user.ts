import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, hasMany, beforeCreate, manyToMany } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import type { HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import { randomUUID } from 'node:crypto'
import List from '#models/list'
import BookTracking from '#models/book_tracking'
import Book from './book.js'

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
  declare password: string

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
}
