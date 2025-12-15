import { DateTime } from 'luxon'
import { BaseModel, column, manyToMany, hasMany } from '@adonisjs/lucid/orm'
import type { ManyToMany, HasMany } from '@adonisjs/lucid/types/relations'
import Category from '#models/category'
import List from '#models/list'
import BookTracking from '#models/book_tracking'
import BookReview from '#models/book_review'
import Author from '#models/author'
import Publisher from '#models/publisher'

const parseStringArray = (value: unknown): string[] | null => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : null
    } catch {
      return null
    }
  }

  return null
}

const serializeStringArray = (value: string[] | null | undefined) => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

export default class Book extends BaseModel {
  public static table = 'books'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare coverImage: string | null

  @column()
  declare type: string | null

  @column()
  declare rating: number | null

  @column()
  declare genres: string[] | null

  @column()
  declare tags: string[] | null

  @column()
  declare releaseYear: number | null

  @column()
  declare endYear: number | null

  @column()
  declare description: string | null

  @column()
  declare descriptionFr: string | null

  @column()
  declare status: string

  @column()
  declare volumes: number | null

  @column()
  declare chapters: number | null

  @column({
    consume: (value) => parseStringArray(value),
    serialize: (value: string[] | null | undefined) => serializeStringArray(value),
    prepare: (value: string[] | null | undefined) => {
      if (!Array.isArray(value) || value.length === 0) {
        return null
      }
      return JSON.stringify(value)
    },
  })
  declare alternativeTitles: string[] | null

  @column({ serializeAs: null })
  declare searchText: string | null

  @column()
  declare dataSource: string | null

  @column()
  declare externalId: number | null

  @column()
  declare nsfw: boolean | null

  @column()
  declare ratingCount: number

  @column()
  declare trackingCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  @manyToMany(() => Category, {
    pivotTable: 'category_books',
  })
  declare categories: ManyToMany<typeof Category>

  @manyToMany(() => List, {
    pivotTable: 'list_books',
    pivotColumns: ['item_number', 'added_at', 'updated_at'],
  })
  declare lists: ManyToMany<typeof List>

  @hasMany(() => BookTracking)
  declare bookTrackings: HasMany<typeof BookTracking>

  @hasMany(() => BookReview)
  declare reviews: HasMany<typeof BookReview>

  @manyToMany(() => Author, {
    pivotTable: 'author_books',
    pivotForeignKey: 'book_id',
    pivotRelatedForeignKey: 'author_id',
  })
  declare authors: ManyToMany<typeof Author>

  @manyToMany(() => Publisher, {
    pivotTable: 'book_publishers',
  })
  declare publishers: ManyToMany<typeof Publisher>
}
