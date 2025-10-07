import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Ensure pg_trgm extension is enabled (should already be done by previous migration)
    await this.schema.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm;')

    // ===== BOOKS TABLE INDEXES =====
    
    // Index on title for text search with pg_trgm
    // This will dramatically speed up: LOWER(title) = ? and title ILIKE queries
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_title_trgm ON books
      USING GIN (title gin_trgm_ops);
    `)

    // Index on title with LOWER for exact match optimization
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_title_lower ON books
      (LOWER(title));
    `)

    // Index on alternative_titles for searching alternative titles
    // Since alternative_titles is TEXT containing JSON, we need to cast it
    // This will speed up jsonb_array_elements_text queries
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_alternative_titles_gin ON books
      USING GIN ((alternative_titles::jsonb) jsonb_path_ops);
    `)

    // Additional index for rating sorting (often used with search)
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_rating_count ON books
      (rating_count DESC NULLS LAST);
    `)

    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_rating ON books
      (rating DESC NULLS LAST);
    `)

    // ===== AUTHORS TABLE INDEXES =====
    
    // Index on authors.name for text search with pg_trgm
    // This will speed up searches that include author names
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_authors_name_trgm ON authors
      USING GIN (name gin_trgm_ops);
    `)

    // Index on authors.name with LOWER for exact match
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_authors_name_lower ON authors
      (LOWER(name));
    `)

    // ===== AUTHOR_BOOKS TABLE INDEXES =====
    
    // Composite index for author-book lookups (both directions)
    // Note: book_id index should exist from FK, but we ensure it here
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_author_books_book_id ON author_books
      (book_id);
    `)

    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_author_books_author_id ON author_books
      (author_id);
    `)
  }

  async down() {
    // Drop all the indexes we created
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_title_trgm;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_title_lower;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_alternative_titles_gin;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_rating_count;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_rating;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_authors_name_trgm;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_authors_name_lower;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_author_books_book_id;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_author_books_author_id;')
  }
}
