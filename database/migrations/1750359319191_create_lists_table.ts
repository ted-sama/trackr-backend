import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'lists'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name').notNullable()
      table.text('description').nullable()
      table.uuid('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
      table.json('tags').nullable()
      table.boolean('is_public').defaultTo(false)
      table.boolean('is_my_library').defaultTo(false)
      table.string('backdrop_mode').defaultTo('color')
      table.string('backdrop_color').defaultTo('#7C3AED')
      table.string('backdrop_image').nullable()
      table.boolean('ranked').defaultTo(false)

      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
