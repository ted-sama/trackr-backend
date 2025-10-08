import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'activity_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.uuid('user_id').references('users.id').notNullable().onDelete('CASCADE')

      // action type
      table.string('action').notNullable()
      table.json('metadata').nullable()

      // resource
      table.string('resource_type', 50).notNullable()
      table.string('resource_id').notNullable()

      table.timestamp('created_at').notNullable().defaultTo(this.now())

      // indexes
      table.index(['user_id', 'created_at'])
      table.index(['user_id', 'action', 'created_at'])
      table.index(['resource_type', 'resource_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
