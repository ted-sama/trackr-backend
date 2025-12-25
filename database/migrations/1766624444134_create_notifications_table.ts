import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.db.rawQuery('gen_random_uuid()').knexQuery)

      // Recipient of the notification
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      // Actor (who triggered the notification)
      table.uuid('actor_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      // Notification type
      table
        .enum('type', ['review_like', 'list_like', 'list_save'], {
          useNative: true,
          enumName: 'notification_type',
          existingType: false,
        })
        .notNullable()

      // Resource concerned (polymorphic)
      table.string('resource_type', 50).notNullable() // 'book_review', 'list'
      table.string('resource_id', 50).notNullable() // Can be UUID or integer as string

      // Read state
      table.boolean('read').defaultTo(false).notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()

      // Indexes for frequent queries
      table.index(['user_id', 'read', 'created_at'])
      table.index(['user_id', 'created_at'])

      // Avoid duplicates (an actor can only generate one notification per resource/type)
      table.unique(['user_id', 'actor_id', 'type', 'resource_type', 'resource_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
    this.schema.raw('DROP TYPE IF EXISTS "notification_type"')
  }
}
