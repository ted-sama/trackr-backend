import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // RevenueCat subscription info
      table.string('subscription_id').nullable() // RevenueCat original_transaction_id
      table
        .enum('subscription_status', ['active', 'cancelled', 'expired', 'billing_issue'])
        .nullable()
      table.timestamp('subscription_expires_at').nullable()
      table.enum('subscription_period', ['monthly', 'yearly']).nullable()

      // Chat request limits
      table.integer('chat_requests_count').defaultTo(0).notNullable()
      table.timestamp('chat_requests_reset_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('subscription_id')
      table.dropColumn('subscription_status')
      table.dropColumn('subscription_expires_at')
      table.dropColumn('subscription_period')
      table.dropColumn('chat_requests_count')
      table.dropColumn('chat_requests_reset_at')
    })
  }
}
