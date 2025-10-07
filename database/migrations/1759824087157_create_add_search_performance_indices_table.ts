import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Index trigram sur authors.name pour la recherche rapide
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_authors_name_trgm ON authors
      USING GIN (name gin_trgm_ops);
    `)

    // Index sur authors.name pour les recherches exactes et LIKE préfixe
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_authors_name ON authors (LOWER(name));
    `)

    // Index sur author_books.book_id pour optimiser les JOIN
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_author_books_book_id ON author_books (book_id);
    `)

    // Index sur author_books.author_id (devrait déjà exister par la FK mais on s'assure)
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_author_books_author_id ON author_books (author_id);
    `)

    // Index trigram sur books.title pour recherche rapide
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_title_trgm ON books
      USING GIN (title gin_trgm_ops);
    `)

    // Index sur LOWER(title) pour les recherches exactes case-insensitive
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_title_lower ON books (LOWER(title));
    `)

    // Index GIN sur alternative_titles JSONB pour recherche rapide
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_alternative_titles_gin ON books
      USING GIN (alternative_titles jsonb_path_ops);
    `)

    // Index sur rating et rating_count pour les tris
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_rating_desc ON books (rating DESC NULLS LAST, rating_count DESC);
    `)

    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_rating_count_desc ON books (rating_count DESC, rating DESC NULLS LAST);
    `)
  }

  async down() {
    await this.schema.raw('DROP INDEX IF EXISTS idx_authors_name_trgm;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_authors_name;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_author_books_book_id;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_author_books_author_id;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_title_trgm;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_title_lower;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_alternative_titles_gin;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_rating_desc;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_rating_count_desc;')
  }
}
