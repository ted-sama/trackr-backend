import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    await this.schema.raw(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ'
    )

    await this.db.rawQuery(
      'UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL'
    )
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('email_verified_at')
    })
  }
}
