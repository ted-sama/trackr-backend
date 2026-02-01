import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'review_comments'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('depth').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('depth')
    })
  }
}
