import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'lists'

  async up() {
    // L'extension pg_trgm devrait déjà être activée par la migration précédente des books
    // Mais on s'assure qu'elle existe au cas où
    await this.schema.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm;')

    // Créer une fonction IMMUTABLE pour concaténer les champs de recherche des listes
    await this.schema.raw(`
      CREATE OR REPLACE FUNCTION concat_list_search_fields(p_name text, p_description text, p_tags text[])
      RETURNS text AS $$
        SELECT p_name || ' ' || 
               COALESCE(p_description, '') || ' ' || 
               COALESCE(array_to_string(p_tags, ' '), '');
      $$ LANGUAGE sql IMMUTABLE;
    `)

    // Ajouter la colonne search_text générée pour les listes
    await this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN IF NOT EXISTS search_text TEXT
      GENERATED ALWAYS AS (concat_list_search_fields(name, description, tags)) STORED;
    `)

    // Créer l'index GIN avec pg_trgm sur la colonne search_text des listes
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_lists_search ON ${this.tableName}
      USING GIN (search_text gin_trgm_ops);
    `)

    // Créer des index supplémentaires pour optimiser la recherche
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_lists_name_trgm ON ${this.tableName}
      USING GIN (name gin_trgm_ops);
    `)

    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_lists_description_trgm ON ${this.tableName}
      USING GIN (description gin_trgm_ops);
    `)
  }

  async down() {
    // Supprimer les index
    await this.schema.raw('DROP INDEX IF EXISTS idx_lists_search;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_lists_name_trgm;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_lists_description_trgm;')

    // Supprimer la colonne search_text
    await this.schema.raw(`
      ALTER TABLE ${this.tableName}
      DROP COLUMN IF EXISTS search_text;
    `)

    // Supprimer la fonction personnalisée
    await this.schema.raw('DROP FUNCTION IF EXISTS concat_list_search_fields(text, text, text[]);')
  }
}