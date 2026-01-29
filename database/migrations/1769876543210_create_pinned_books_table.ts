import { kebabCase } from '@adonisjs/core/helpers'
import type { Knex } from 'knex'

export default async function up(knex: Knex) {
  return knex.schema.createTable('pinned_books', (table) => {
    table.increments('id')
    table.string('user_id').notNullable()
    table.integer('book_id').notNullable()
    table.timestamp('created_at').defaultTo(knex.fn.now())
    table.timestamp('updated_at').defaultTo(knex.fn.now())

    // Foreign keys
    table.foreign('user_id').references('users.id').onDelete('cascade')
    table.foreign('book_id').references('books.id').onDelete('cascade')

    // Unique constraint - one pinned book per user
    table.unique(['user_id'])

    // Indexes for faster queries
    table.index('user_id')
    table.index('book_id')
  })
}

export async function down(knex: Knex) {
  return knex.schema.dropTable('pinned_books')
}
