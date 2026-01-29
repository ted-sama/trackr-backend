import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Book from '#models/book'

export default class BookRecap extends BaseModel {
  public static table = 'book_recaps'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: string

  @column()
  declare bookId: number

  @column()
  declare chapter: number

  @column()
  declare recap: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare expiresAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Book)
  declare book: BelongsTo<typeof Book>
}
