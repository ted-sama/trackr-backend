import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected authorsTable = 'authors'
  protected pivotTable = 'author_books'

  async up() {
    this.schema.createTable(this.authorsTable, (table) => {
      table.increments('id')
      table.string('name').notNullable().unique()
      table.timestamps(true, true)
    })

    this.schema.createTable(this.pivotTable, (table) => {
      table
        .integer('author_id')
        .unsigned()
        .references('id')
        .inTable(this.authorsTable)
        .onDelete('CASCADE')
      table.integer('book_id').unsigned().references('id').inTable('books').onDelete('CASCADE')

      table.primary(['author_id', 'book_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.pivotTable)
    this.schema.dropTable(this.authorsTable)
  }
}
