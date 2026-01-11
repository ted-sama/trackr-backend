import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Add new values to the notification_type enum
    this.schema.raw(`ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'new_follower'`)
    this.schema.raw(`ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'new_friend'`)
  }

  async down() {
    // Note: PostgreSQL doesn't support removing enum values directly
    // This would require recreating the enum and all dependent columns
    // For simplicity, we leave the enum values in place on rollback
  }
}
