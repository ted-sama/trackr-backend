import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'review_comments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))

      table
        .integer('review_id')
        .notNullable()
        .references('id')
        .inTable('book_reviews')
        .onDelete('CASCADE')

      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      // Self-referencing foreign key for nested replies (1-level only)
      table
        .uuid('parent_id')
        .nullable()
        .references('id')
        .inTable('review_comments')
        .onDelete('CASCADE')

      table.text('content').notNullable()
      table.integer('likes_count').notNullable().defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Indexes
      table.index(['review_id'])
      table.index(['user_id'])
      table.index(['parent_id'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
