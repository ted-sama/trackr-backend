import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reports'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Add priority column with default 'medium'
      table.string('priority', 20).defaultTo('medium').notNullable()

      // Index for sorting by priority
      table.index(['priority', 'status', 'created_at'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['priority', 'status', 'created_at'])
      table.dropColumn('priority')
    })
  }
}
