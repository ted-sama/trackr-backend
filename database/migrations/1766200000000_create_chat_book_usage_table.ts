import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'chat_book_usage'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.integer('book_id').unsigned().notNullable().references('id').inTable('books').onDelete('CASCADE')

      // All-time total requests for this book
      table.integer('total_requests').defaultTo(0).notNullable()

      // Monthly requests (resets when user's chat_requests_reset_at is passed)
      table.integer('monthly_requests').defaultTo(0).notNullable()

      // Timestamp of last monthly reset (synced with user's reset)
      table.timestamp('last_reset_at').nullable()

      // Last time a chat request was made for this book
      table.timestamp('last_used_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // Unique constraint: one record per user/book combo
      table.unique(['user_id', 'book_id'])

      // Index for querying user's chat usage
      table.index(['user_id', 'total_requests'])
      table.index(['user_id', 'monthly_requests'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
