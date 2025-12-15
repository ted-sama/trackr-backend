import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_reviews'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.integer('book_id').notNullable().references('id').inTable('books').onDelete('CASCADE')
      table.text('content').notNullable()
      table.integer('likes_count').notNullable().defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Constraints
      table.unique(['user_id', 'book_id'])

      // Indexes
      table.index(['book_id'])
      table.index(['user_id'])
      table.index(['likes_count'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
