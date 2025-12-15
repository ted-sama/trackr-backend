import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_review_likes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table
        .integer('review_id')
        .notNullable()
        .references('id')
        .inTable('book_reviews')
        .onDelete('CASCADE')

      table.timestamp('created_at').notNullable()

      // Composite primary key
      table.primary(['user_id', 'review_id'])

      // Indexes
      table.index(['review_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
