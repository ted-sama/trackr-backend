import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'books'

  async up() {
    // Activer l'extension pg_trgm (une fois par DB)
    await this.schema.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm;')

    // Créer une fonction IMMUTABLE pour encapsuler l'expression (résout l'erreur d'immutabilité)
    await this.schema.raw(`
      CREATE OR REPLACE FUNCTION concat_titles(p_title text, p_alt_titles json)
      RETURNS text AS $$
        SELECT trim(BOTH ' ' FROM concat_ws(' ',
          p_title,
          (
            SELECT string_agg(alt.elem, ' ')
            FROM jsonb_array_elements_text(
              CASE
                WHEN p_alt_titles IS NULL THEN '[]'::jsonb
                WHEN json_typeof(p_alt_titles) = 'array' THEN p_alt_titles::jsonb
                ELSE '[]'::jsonb
              END
            ) AS alt(elem)
          )
        ));
      $$ LANGUAGE sql IMMUTABLE;
    `)

    // Remplacer l'ancienne colonne textuelle par une colonne générée
    await this.schema.raw(`
      ALTER TABLE ${this.tableName}
      DROP COLUMN IF EXISTS search_text;
    `)

    await this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN search_text TEXT
      GENERATED ALWAYS AS (concat_titles(title, alternative_titles::json)) STORED;
    `)

    // Créer l'index GIN sur la colonne générée
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_search ON ${this.tableName}
      USING GIN (search_text gin_trgm_ops);
    `)
  }

  async down() {
    // Supprimer l'index
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_search;')

    // Supprimer la colonne générée
    await this.schema.raw(`
      ALTER TABLE ${this.tableName}
      DROP COLUMN IF EXISTS search_text;
    `)

    // Restaurer la colonne textuelle initiale
    await this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN IF NOT EXISTS search_text TEXT;
    `)

    // Supprimer la fonction personnalisée
    await this.schema.raw('DROP FUNCTION IF EXISTS concat_titles(text, json);')

    // Supprimer l'extension (seulement si rien d'autre ne l'utilise)
    await this.schema.raw('DROP EXTENSION IF EXISTS pg_trgm;')
  }
}
