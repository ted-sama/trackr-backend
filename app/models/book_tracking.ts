import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Book from '#models/book'

export default class BookTracking extends BaseModel {
  public static table = 'book_tracking'

  @column({ isPrimary: true })
  declare userId: string

  @column({ isPrimary: true })
  declare bookId: number

  @column()
  declare status: string

  @column()
  declare currentChapter: number | null

  @column()
  declare currentVolume: number | null

  @column()
  declare rating: number | null

  @column.date()
  declare startDate: DateTime | null

  @column.date()
  declare finishDate: DateTime | null

  @column()
  declare notes: string | null

  @column.dateTime()
  declare lastReadAt: DateTime | null

  @column.dateTime()
  declare createdAt: DateTime

  @column.dateTime()
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Book)
  declare book: BelongsTo<typeof Book>
}
