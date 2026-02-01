import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'review_comment_mentions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .uuid('comment_id')
        .notNullable()
        .references('id')
        .inTable('review_comments')
        .onDelete('CASCADE')

      table
        .uuid('mentioned_user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.timestamp('created_at').notNullable()

      // Composite primary key
      table.primary(['comment_id', 'mentioned_user_id'])

      // Indexes
      table.index(['mentioned_user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
