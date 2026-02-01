import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'books'

  async up() {
    // Change external_id from integer to text for UUID support (MangaDex)
    // Using a two-step process: add new column, copy data, drop old, rename new
    this.schema.alterTable(this.tableName, (table) => {
      table.text('external_id_new').nullable()
    })

    this.defer(async (db) => {
      await db.rawQuery('UPDATE books SET external_id_new = external_id::text WHERE external_id IS NOT NULL')
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('external_id')
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('external_id_new', 'external_id')
    })

    // Also update publishers table external_id for consistency
    this.schema.alterTable('publishers', (table) => {
      table.text('external_id_pub_new').nullable()
    })

    this.defer(async (db) => {
      await db.rawQuery('UPDATE publishers SET external_id_pub_new = external_id::text WHERE external_id IS NOT NULL')
    })

    this.schema.alterTable('publishers', (table) => {
      table.dropColumn('external_id')
    })

    this.schema.alterTable('publishers', (table) => {
      table.renameColumn('external_id_pub_new', 'external_id')
    })
  }

  async down() {
    // Revert books table
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('external_id_old').nullable()
    })

    this.defer(async (db) => {
      await db.rawQuery('UPDATE books SET external_id_old = external_id::integer WHERE external_id ~ \'^[0-9]+$\'')
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('external_id')
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('external_id_old', 'external_id')
    })

    // Revert publishers table
    this.schema.alterTable('publishers', (table) => {
      table.integer('external_id_old').nullable()
    })

    this.defer(async (db) => {
      await db.rawQuery('UPDATE publishers SET external_id_old = external_id::integer WHERE external_id ~ \'^[0-9]+$\'')
    })

    this.schema.alterTable('publishers', (table) => {
      table.dropColumn('external_id')
    })

    this.schema.alterTable('publishers', (table) => {
      table.renameColumn('external_id_old', 'external_id')
    })
  }
}
