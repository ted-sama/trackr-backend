import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_trackings'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('rated_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('rated_at')
    })
  }
}
