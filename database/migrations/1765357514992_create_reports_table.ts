import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reports'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))

      table.uuid('reporter_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.string('resource_type').notNullable() // 'user', 'list'
      table.string('resource_id').notNullable() // ID of the reported content (user UUID or list ID as string)

      table.string('reason').notNullable() // 'offensive_content', 'spam', 'harassment', 'other'
      table.text('description').nullable() // Additional details from reporter

      table.string('status').notNullable().defaultTo('pending') // 'pending', 'reviewed', 'resolved', 'rejected'
      table.uuid('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.text('moderator_notes').nullable()
      table.timestamp('reviewed_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['reporter_id'])
      table.index(['status'])
      table.index(['resource_type', 'resource_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
