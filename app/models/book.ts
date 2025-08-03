import { DateTime } from 'luxon'
import { BaseModel, column, manyToMany, hasMany } from '@adonisjs/lucid/orm'
import type { ManyToMany, HasMany } from '@adonisjs/lucid/types/relations'
import Category from '#models/category'
import Chapter from '#models/chapter'
import List from '#models/list'
import BookTracking from '#models/book_tracking'

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
  declare author: string | null

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

  @column()
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

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  @manyToMany(() => Category, {
    pivotTable: 'category_books',
  })
  declare categories: ManyToMany<typeof Category>

  @hasMany(() => Chapter)
  declare chapterList: HasMany<typeof Chapter>

  @manyToMany(() => List, {
    pivotTable: 'list_books',
    pivotColumns: ['item_number', 'added_at', 'updated_at'],
  })
  declare lists: ManyToMany<typeof List>

  @hasMany(() => BookTracking)
  declare bookTrackings: HasMany<typeof BookTracking>
}
