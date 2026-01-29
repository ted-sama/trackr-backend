import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_recaps'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.integer('book_id').unsigned().notNullable().references('id').inTable('books').onDelete('CASCADE')
      table.integer('chapter').notNullable()
      table.text('recap').notNullable()
      table.timestamp('created_at').notNullable()

      // Unique constraint: one recap per user/book/chapter combination
      table.unique(['user_id', 'book_id', 'chapter'])

      // Index for quick lookups
      table.index(['user_id', 'book_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
