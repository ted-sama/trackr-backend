import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_reviews'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_spoiler').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_spoiler')
    })
  }
}
