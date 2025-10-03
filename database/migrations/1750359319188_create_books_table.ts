import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'books'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.text('title').notNullable()
      table.string('cover_image').nullable()
      table.string('type').nullable()
      table.decimal('rating', 3, 2).nullable()
      table.json('genres').nullable()
      table.json('tags').nullable()
      table.integer('release_year').nullable()
      table.integer('end_year').nullable()
      table.string('author').nullable()
      table.text('description').nullable()
      table.text('description_fr').nullable()
      table.string('status').notNullable()
      table.integer('volumes').nullable()
      table.integer('chapters').nullable()
      table.text('alternative_titles').nullable()
      table.text('search_text').nullable()
      table.string('data_source').nullable()
      table.integer('external_id').nullable()
      table.boolean('nsfw').nullable()
      table.integer('rating_count').defaultTo(0)

      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
