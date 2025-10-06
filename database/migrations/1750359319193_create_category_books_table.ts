import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'category_books'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .integer('category_id')
        .unsigned()
        .references('id')
        .inTable('categories')
        .onDelete('CASCADE')
      table.integer('book_id').unsigned().references('id').inTable('books').onDelete('CASCADE')

      table.primary(['category_id', 'book_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
