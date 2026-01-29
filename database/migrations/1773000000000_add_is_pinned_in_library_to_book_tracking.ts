import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_tracking'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_pinned_in_library').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_pinned_in_library')
    })
  }
}
