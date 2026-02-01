import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'review_comment_likes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table
        .uuid('comment_id')
        .notNullable()
        .references('id')
        .inTable('review_comments')
        .onDelete('CASCADE')

      table.timestamp('created_at').notNullable()

      // Composite primary key
      table.primary(['user_id', 'comment_id'])

      // Indexes
      table.index(['comment_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
