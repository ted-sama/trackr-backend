import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_reviews'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('revisions_count').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('revisions_count')
    })
  }
}