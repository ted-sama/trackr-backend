import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    // Migrate existing privacy settings to preferences JSON column
    // Only update users where at least one privacy setting is false (non-default)
    this.db.rawQuery(`
      UPDATE users
      SET preferences = (
        COALESCE(preferences::jsonb, '{}'::jsonb) || jsonb_build_object(
          'privacy', jsonb_build_object(
            'statsPublic', is_stats_public,
            'activityPublic', is_activity_public
          )
        )
      )::json
      WHERE is_stats_public = false OR is_activity_public = false
    `)

    // Drop the old columns
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_stats_public')
      table.dropColumn('is_activity_public')
    })
  }

  async down() {
    // Re-add the columns
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_stats_public').defaultTo(true).notNullable()
      table.boolean('is_activity_public').defaultTo(true).notNullable()
    })

    // Migrate data back from preferences to columns
    this.defer(async () => {
      await this.db.rawQuery(`
        UPDATE users
        SET
          is_stats_public = COALESCE((preferences::jsonb->'privacy'->>'statsPublic')::boolean, true),
          is_activity_public = COALESCE((preferences::jsonb->'privacy'->>'activityPublic')::boolean, true)
        WHERE preferences::jsonb->'privacy' IS NOT NULL
      `)

      // Remove privacy key from preferences
      await this.db.rawQuery(`
        UPDATE users
        SET preferences = (preferences::jsonb - 'privacy')::json
        WHERE preferences::jsonb->'privacy' IS NOT NULL
      `)
    })
  }
}
