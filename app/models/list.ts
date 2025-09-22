import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, manyToMany, computed } from '@adonisjs/lucid/orm'
import type { BelongsTo, ManyToMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Book from '#models/book'

export default class List extends BaseModel {
  public static table = 'lists'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column({ serializeAs: null })
  declare userId: string | null

  @column()
  declare tags: string[] | null

  @column()
  declare isPublic: boolean

  @column({ serializeAs: null })
  declare isMyLibrary: boolean

  @column()
  declare backdropMode: string

  @column()
  declare backdropColor: string

  @column()
  declare backdropImage: string | null

  @column()
  declare ranked: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, {
    serializeAs: 'owner',
  })
  declare user: BelongsTo<typeof User>

  @manyToMany(() => Book, {
    pivotTable: 'list_books',
    pivotColumns: ['item_number', 'added_at', 'updated_at'],
    serializeAs: null,
  })
  declare bookItems: ManyToMany<typeof Book>

  @computed()
  get books() {
    if (!this.$preloaded.bookItems) {
      return null
    }

    return {
      total: this.bookItems.length,
      items: this.bookItems.map((book) => book.serialize()),
    }
  }
}
