import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_tracking'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE')
      table.integer('book_id').unsigned().references('id').inTable('books').onDelete('CASCADE')

      table.primary(['user_id', 'book_id'])

      table
        .enum('status', ['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read'])
        .notNullable()
        .defaultTo('plan_to_read')
      table.integer('current_chapter').nullable()
      table.integer('current_volume').nullable()
      table.decimal('rating', 2, 1).nullable()
      table.date('start_date').nullable()
      table.date('finish_date').nullable()
      table.text('notes').nullable()
      table.timestamp('last_read_at').nullable()

      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
