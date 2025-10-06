import { DateTime } from 'luxon'
import { BaseModel, column, manyToMany } from '@adonisjs/lucid/orm'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'
import Book from '#models/book'

export default class Category extends BaseModel {
  public static table = 'categories'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare titleFr: string | null

  @column()
  declare description: string | null

  @column()
  declare descriptionFr: string | null

  @column()
  declare isFeatured: boolean | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  @manyToMany(() => Book, {
    pivotTable: 'category_books',
  })
  declare books: ManyToMany<typeof Book>
}
