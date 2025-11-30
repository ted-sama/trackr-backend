import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'books'

  async up() {
    // No migration needed - trackingCount is computed via accessor
  }

  async down() {
    // No migration needed - trackingCount is computed via accessor
  }
}
