import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Add new notification types to the existing enum
    this.schema.raw(`
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'content_moderated';
    `)
    this.schema.raw(`
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'strike_received';
    `)
    this.schema.raw(`
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'account_banned';
    `)
    this.schema.raw(`
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'account_unbanned';
    `)
    this.schema.raw(`
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'report_resolved';
    `)
  }

  async down() {
    // Note: PostgreSQL doesn't support removing enum values easily
    // This would require recreating the enum type which is risky
    // We'll leave the values in place for rollback safety
  }
}
