import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'publishers'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name').notNullable()
      table.string('data_source').nullable()
      table.integer('external_id').nullable()
      table.timestamps(true, true)

      table.unique(['data_source', 'external_id'])
    })

    this.schema.createTable('book_publishers', (table) => {
      table.increments('id')
      table.integer('book_id').unsigned().references('id').inTable('books').onDelete('CASCADE')
      table
        .integer('publisher_id')
        .unsigned()
        .references('id')
        .inTable('publishers')
        .onDelete('CASCADE')
      table.timestamps(true, true)

      table.unique(['book_id', 'publisher_id'])
    })
  }

  async down() {
    this.schema.dropTable('book_publishers')
    this.schema.dropTable(this.tableName)
  }
}
