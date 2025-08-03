import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'books'

  async up() {
    // Activer l'extension pg_trgm (une fois par DB)
    await this.schema.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm;')

    // Créer une fonction IMMUTABLE pour encapsuler l'expression (résout l'erreur d'immutabilité)
    await this.schema.raw(`
      CREATE OR REPLACE FUNCTION concat_titles(p_title text, p_alt_titles text[])
      RETURNS text AS $$
        SELECT p_title || ' ' || array_to_string(p_alt_titles, ' ');
      $$ LANGUAGE sql IMMUTABLE;
    `)

    // Ajouter la colonne générée en utilisant la fonction IMMUTABLE
    await this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN IF NOT EXISTS search_text TEXT
      GENERATED ALWAYS AS (concat_titles(title, alternative_titles)) STORED;
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

    // Supprimer la fonction personnalisée
    await this.schema.raw('DROP FUNCTION IF EXISTS concat_titles(text, text[]);')

    // Supprimer l'extension (seulement si rien d'autre ne l'utilise)
    await this.schema.raw('DROP EXTENSION IF EXISTS pg_trgm;')
  }
}
