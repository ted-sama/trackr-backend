import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary()
      table.string('username').unique().notNullable()
      table.string('display_name').nullable()
      table.string('email').unique().notNullable()
      table.string('password').notNullable()
      table.string('avatar').nullable()
      table.enum('role', ['admin', 'user']).defaultTo('user').notNullable()
      table.enum('plan', ['free', 'plus']).defaultTo('free').notNullable()
      table.json('preferences').nullable()
      table.string('backdrop_mode').defaultTo('color')
      table.string('backdrop_color').defaultTo('#7C3AED')
      table.string('backdrop_image').nullable()

      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
