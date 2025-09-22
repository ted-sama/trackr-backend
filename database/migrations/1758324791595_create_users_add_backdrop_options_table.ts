import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('backdrop_mode').defaultTo('color').notNullable()
      table.string('backdrop_color').defaultTo('#8B5CF6').notNullable()
      table.string('backdrop_image').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('backdrop_mode')
      table.dropColumn('backdrop_color')
      table.dropColumn('backdrop_image')
    })
  }
}
