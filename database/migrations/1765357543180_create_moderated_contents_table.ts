import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'moderated_contents'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))

      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.string('resource_type').notNullable() // 'username', 'display_name', 'list_name', 'list_description', 'list_tags', 'book_notes'
      table.string('resource_id').nullable() // ID of the parent entity (list_id, book_tracking_id, etc.) - string to handle both UUID and numeric IDs

      table.text('original_content').notNullable() // The flagged content
      table.text('censored_content').nullable() // Auto-censored version

      table.string('action').notNullable() // 'warning', 'auto_censored', 'deleted', 'user_banned'
      table.string('reason').notNullable() // 'profanity', 'hate_speech', 'spam', 'harassment', 'reported'

      table.uuid('moderated_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.text('moderator_notes').nullable()

      table.boolean('is_active').notNullable().defaultTo(true)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['user_id'])
      table.index(['resource_type'])
      table.index(['action'])
      table.index(['is_active'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
