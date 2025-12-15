import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_review_revisions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      table
        .integer('review_id')
        .notNullable()
        .references('id')
        .inTable('book_reviews')
        .onDelete('CASCADE')
      table.text('content').notNullable()

      table.timestamp('created_at').notNullable()

      // Indexes
      table.index(['review_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
