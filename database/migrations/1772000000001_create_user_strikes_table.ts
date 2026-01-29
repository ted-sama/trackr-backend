import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_strikes'

  async up() {
    // Create enum for strike reasons
    this.schema.raw(`
      CREATE TYPE strike_reason AS ENUM ('profanity', 'hate_speech', 'spam', 'harassment', 'other')
    `)

    // Create enum for strike severity
    this.schema.raw(`
      CREATE TYPE strike_severity AS ENUM ('minor', 'moderate', 'severe')
    `)

    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))

      // Target user
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      // Strike details
      table
        .enum('reason', ['profanity', 'hate_speech', 'spam', 'harassment', 'other'], {
          useNative: true,
          enumName: 'strike_reason',
          existingType: true,
        })
        .notNullable()

      table
        .enum('severity', ['minor', 'moderate', 'severe'], {
          useNative: true,
          enumName: 'strike_severity',
          existingType: true,
        })
        .notNullable()

      // Who issued the strike (null = automatic)
      table.uuid('issued_by').nullable().references('id').inTable('users').onDelete('SET NULL')

      // Related report (if any)
      table.uuid('report_id').nullable().references('id').inTable('reports').onDelete('SET NULL')

      // Related moderated content (if any)
      table
        .uuid('moderated_content_id')
        .nullable()
        .references('id')
        .inTable('moderated_contents')
        .onDelete('SET NULL')

      // Additional information
      table.text('notes').nullable()

      // Strike expiration (null = never expires)
      table.timestamp('expires_at').nullable()

      // Timestamps
      table.timestamp('created_at').notNullable()

      // Indexes
      table.index(['user_id'])
      table.index(['user_id', 'expires_at'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
    this.schema.raw('DROP TYPE IF EXISTS strike_reason')
    this.schema.raw('DROP TYPE IF EXISTS strike_severity')
  }
}
