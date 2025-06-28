import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Chapter from '#models/chapter'

export default class Source extends BaseModel {
  public static table = 'sources'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare bookCategories: string

  @column()
  declare url: string | null

  @hasMany(() => Chapter)
  declare chapters: HasMany<typeof Chapter>
}
