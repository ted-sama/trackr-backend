import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_reviews'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('rating', 3, 1).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('rating')
    })
  }
}
