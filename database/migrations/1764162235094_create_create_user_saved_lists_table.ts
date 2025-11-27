import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_saved_lists'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.integer('list_id').unsigned().notNullable().references('id').inTable('lists').onDelete('CASCADE')

      table.unique(['user_id', 'list_id'])
      table.timestamp('created_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}