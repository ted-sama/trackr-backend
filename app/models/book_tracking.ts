import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, beforeUpdate, beforeSave } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Book from '#models/book'
export default class BookTracking extends BaseModel {
  public static table = 'book_tracking'

  @beforeUpdate()
  static async updatedAt(bookTracking: BookTracking) {
    bookTracking.updatedAt = DateTime.now()
  }

  @beforeSave()
  static async lastReadAt(bookTracking: BookTracking) {
    if (bookTracking.currentChapter === null && bookTracking.currentVolume === null) {
      bookTracking.lastReadAt = null
    }
  }

  @beforeSave()
  static async currentChapter(bookTracking: BookTracking) {
    if (bookTracking.currentChapter === 0) {
      bookTracking.currentChapter = null
    }
  }

  @column({ isPrimary: true })
  declare userId: string

  @column({ isPrimary: true })
  declare bookId: number

  @column()
  declare status: 'reading' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_read'

  @column()
  declare currentChapter: number | null

  @column()
  declare currentVolume: number | null

  @column()
  declare rating: number | null

  @column.dateTime()
  declare ratedAt: DateTime | null

  @column.date()
  declare startDate: DateTime | null

  @column.date()
  declare finishDate: DateTime | null

  @column()
  declare notes: string | null

  @column.dateTime()
  declare lastReadAt: DateTime | null

  @column()
  declare isPinnedInLibrary: boolean

  @column.dateTime()
  declare createdAt: DateTime

  @column.dateTime()
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Book)
  declare book: BelongsTo<typeof Book>
}
