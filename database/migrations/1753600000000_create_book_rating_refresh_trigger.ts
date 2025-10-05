import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'book_tracking'

  async up() {
    await this.schema.raw(`
      DROP TRIGGER IF EXISTS book_tracking_refresh_book_rating ON ${this.tableName};
    `)

    await this.schema.raw(`
      CREATE OR REPLACE FUNCTION refresh_book_rating()
      RETURNS TRIGGER AS $$
      DECLARE
        affected_book_id INTEGER;
        stats RECORD;
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          affected_book_id := OLD.book_id;
        ELSE
          affected_book_id := NEW.book_id;
        END IF;

        SELECT
          COUNT(*)::INT AS rating_count,
          AVG(rating)::numeric AS average_rating
        INTO stats
        FROM book_tracking
        WHERE book_id = affected_book_id AND rating IS NOT NULL;

        UPDATE books
        SET
          rating_count = COALESCE(stats.rating_count, 0),
          rating = CASE
            WHEN COALESCE(stats.rating_count, 0) > 0 AND stats.average_rating IS NOT NULL
              THEN ROUND(stats.average_rating::numeric, 2)
            ELSE NULL
          END
        WHERE id = affected_book_id;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `)

    await this.schema.raw(`
      CREATE TRIGGER book_tracking_refresh_book_rating
      AFTER INSERT OR UPDATE OF rating OR DELETE ON ${this.tableName}
      FOR EACH ROW
      EXECUTE FUNCTION refresh_book_rating();
    `)
  }

  async down() {
    await this.schema.raw(`
      DROP TRIGGER IF EXISTS book_tracking_refresh_book_rating ON ${this.tableName};
    `)

    await this.schema.raw(`
      DROP FUNCTION IF EXISTS refresh_book_rating();
    `)
  }
}
