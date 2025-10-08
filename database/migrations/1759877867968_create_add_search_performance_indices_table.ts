import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Index pour optimiser les recherches par book_id dans author_books
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_author_books_book_id 
      ON author_books(book_id);
    `)

    // Index pour optimiser les recherches par author_id dans author_books
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_author_books_author_id 
      ON author_books(author_id);
    `)

    // Index GIN pour les recherches de texte sur les noms d'auteurs
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_authors_name_trgm 
      ON authors USING GIN (name gin_trgm_ops);
    `)

    // Index pour optimiser les tris par rating sur books
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_rating_count 
      ON books(rating_count DESC NULLS LAST) WHERE nsfw = false;
    `)

    // Index pour optimiser les tris par rating sur books (incluant rating)
    await this.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_books_rating_rating_count 
      ON books(rating DESC NULLS LAST, rating_count DESC NULLS LAST) WHERE nsfw = false;
    `)
  }

  async down() {
    await this.schema.raw('DROP INDEX IF EXISTS idx_author_books_book_id;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_author_books_author_id;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_authors_name_trgm;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_rating_count;')
    await this.schema.raw('DROP INDEX IF EXISTS idx_books_rating_rating_count;')
  }
}
