import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // 1. Ajouter la colonne tracking_count à la table books
    await this.schema.raw(`
      ALTER TABLE books ADD COLUMN IF NOT EXISTS tracking_count INTEGER NOT NULL DEFAULT 0
    `)

    // 2. Initialiser tracking_count avec les valeurs existantes
    await this.schema.raw(`
      UPDATE books
      SET tracking_count = (
        SELECT COUNT(*)::int
        FROM book_tracking
        WHERE book_tracking.book_id = books.id
      )
    `)

    // 3. Supprimer l'ancien trigger
    await this.schema.raw(`
      DROP TRIGGER IF EXISTS book_tracking_refresh_book_rating ON book_tracking;
    `)

    // 4. Mettre à jour la fonction pour gérer rating ET tracking_count
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
          COUNT(*)::INT AS tracking_count,
          COUNT(rating)::INT AS rating_count,
          AVG(rating)::numeric AS average_rating
        INTO stats
        FROM book_tracking
        WHERE book_id = affected_book_id;

        UPDATE books
        SET
          tracking_count = COALESCE(stats.tracking_count, 0),
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

    // 5. Recréer le trigger pour tous les INSERT/UPDATE/DELETE
    await this.schema.raw(`
      CREATE TRIGGER book_tracking_refresh_book_rating
      AFTER INSERT OR UPDATE OR DELETE ON book_tracking
      FOR EACH ROW
      EXECUTE FUNCTION refresh_book_rating();
    `)
  }

  async down() {
    // 1. Supprimer le trigger mis à jour
    await this.schema.raw(`
      DROP TRIGGER IF EXISTS book_tracking_refresh_book_rating ON book_tracking;
    `)

    // 2. Restaurer l'ancienne fonction (rating uniquement)
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

    // 3. Recréer l'ancien trigger
    await this.schema.raw(`
      CREATE TRIGGER book_tracking_refresh_book_rating
      AFTER INSERT OR UPDATE OF rating OR DELETE ON book_tracking
      FOR EACH ROW
      EXECUTE FUNCTION refresh_book_rating();
    `)

    // 4. Supprimer la colonne tracking_count
    await this.schema.raw(`
      ALTER TABLE books DROP COLUMN IF EXISTS tracking_count
    `)
  }
}
