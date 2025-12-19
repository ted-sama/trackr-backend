import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Privacy settings - public by default
      table.boolean('is_stats_public').defaultTo(true).notNullable()
      table.boolean('is_activity_public').defaultTo(true).notNullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_stats_public')
      table.dropColumn('is_activity_public')
    })
  }
}
