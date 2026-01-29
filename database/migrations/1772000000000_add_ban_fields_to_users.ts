import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Ban status fields
      table.boolean('is_banned').defaultTo(false).notNullable()
      table.timestamp('banned_until').nullable()
      table.text('ban_reason').nullable()
      table.uuid('banned_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.timestamp('banned_at').nullable()

      // Strike system
      table.integer('strike_count').defaultTo(0).notNullable()
      table.timestamp('last_strike_at').nullable()

      // Index for checking banned users
      table.index(['is_banned', 'banned_until'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['is_banned', 'banned_until'])
      table.dropColumn('is_banned')
      table.dropColumn('banned_until')
      table.dropColumn('ban_reason')
      table.dropColumn('banned_by')
      table.dropColumn('banned_at')
      table.dropColumn('strike_count')
      table.dropColumn('last_strike_at')
    })
  }
}
