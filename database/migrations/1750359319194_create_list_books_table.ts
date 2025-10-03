import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'list_books'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.integer('list_id').unsigned().references('id').inTable('lists').onDelete('CASCADE')
      table.integer('book_id').unsigned().references('id').inTable('books').onDelete('CASCADE')
      
      table.primary(['list_id', 'book_id'])
      
      table.integer('item_number').nullable()
      table.timestamp('added_at').defaultTo(this.now())
      table.timestamp('updated_at').defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}