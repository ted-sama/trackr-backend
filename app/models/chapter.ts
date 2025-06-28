import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Book from '#models/book'
import Source from '#models/source'

export default class Chapter extends BaseModel {
  public static table = 'chapters'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare volume: number | null

  @column()
  declare chapter: number

  @column()
  declare externalUrl: string

  @column.date()
  declare publishedAt: DateTime

  @column()
  declare translationLanguage: string

  @column()
  declare sourceId: number

  @column()
  declare bookId: number

  @belongsTo(() => Book)
  declare book: BelongsTo<typeof Book>

  @belongsTo(() => Source)
  declare source: BelongsTo<typeof Source>
}
