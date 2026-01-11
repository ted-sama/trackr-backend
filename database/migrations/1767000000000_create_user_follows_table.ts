import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_follows'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      // User who is following
      table.uuid('follower_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      // User being followed
      table.uuid('following_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.timestamp('created_at').notNullable()

      // Composite primary key - one follow relationship per pair
      table.primary(['follower_id', 'following_id'])

      // Indexes for fast lookups
      table.index(['following_id']) // For counting/listing followers
      table.index(['follower_id']) // For counting/listing following
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
