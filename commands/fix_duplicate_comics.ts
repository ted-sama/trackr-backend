import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'

export default class FixDuplicateComics extends BaseCommand {
  static commandName = 'fix:duplicate-comics'
  static description =
    'Fix duplicate comic names by adding year disambiguation and set chapters to null for ongoing comics'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.boolean({ description: 'Only show what would be changed (dry run)' })
  declare dryRun: boolean

  async run() {
    if (this.dryRun) {
      this.logger.info('🔍 Dry run mode - no changes will be made')
    }

    await this.fixOngoingComicsChapters()
    await this.deduplicateComicNames()

    this.logger.success('Fix completed!')
  }

  /**
   * Met chapters à null pour les comics en cours (sans end_year)
   */
  private async fixOngoingComicsChapters() {
    this.logger.info('Fixing chapters for ongoing comics (no end_year)...')

    // Trouver les comics sans end_year qui ont encore des chapters
    const ongoingComics = await db
      .from('books')
      .select('id', 'title', 'chapters', 'end_year')
      .where('type', 'comic')
      .where('data_source', 'gcd')
      .whereNull('end_year')
      .whereNotNull('chapters')

    if (ongoingComics.length === 0) {
      this.logger.info('No ongoing comics with chapters to fix')
      return
    }

    this.logger.info(`Found ${ongoingComics.length} ongoing comics with chapters to set to null`)

    if (this.dryRun) {
      for (const comic of ongoingComics.slice(0, 10)) {
        this.logger.info(`  Would update: "${comic.title}" (chapters: ${comic.chapters} -> null)`)
      }
      if (ongoingComics.length > 10) {
        this.logger.info(`  ... and ${ongoingComics.length - 10} more`)
      }
      return
    }

    // Mettre à jour tous les comics en cours
    const result = await db
      .from('books')
      .where('type', 'comic')
      .where('data_source', 'gcd')
      .whereNull('end_year')
      .whereNotNull('chapters')
      .update({
        chapters: null,
        updated_at: new Date(),
      })

    this.logger.success(`Updated ${result} ongoing comics (chapters set to null)`)
  }

  /**
   * Déduplique les noms de comics en ajoutant l'année au titre
   * pour les comics qui partagent le même nom
   * Ex: "The Amazing Spider-Man" -> "The Amazing Spider-Man (2022)"
   */
  private async deduplicateComicNames() {
    this.logger.info('Checking for duplicate comic names...')

    // Trouver tous les titres qui apparaissent plus d'une fois
    const duplicates = await db
      .from('books')
      .select('title')
      .where('type', 'comic')
      .where('data_source', 'gcd')
      .groupBy('title')
      .havingRaw('COUNT(*) > 1')

    if (duplicates.length === 0) {
      this.logger.info('No duplicate comic names found')
      return
    }

    this.logger.info(`Found ${duplicates.length} duplicate titles to fix`)

    let updated = 0

    for (const dup of duplicates) {
      // Récupérer tous les comics avec ce titre
      const comics = await db
        .from('books')
        .select('id', 'title', 'release_year')
        .where('type', 'comic')
        .where('data_source', 'gcd')
        .where('title', dup.title)
        .orderBy('release_year', 'asc')

      for (const comic of comics) {
        if (comic.release_year) {
          // Ne pas ajouter l'année si elle est déjà dans le titre
          if (!comic.title.includes(`(${comic.release_year})`)) {
            const newTitle = `${comic.title} (${comic.release_year})`

            if (this.dryRun) {
              this.logger.info(`  Would rename: "${comic.title}" -> "${newTitle}"`)
            } else {
              await db.from('books').where('id', comic.id).update({
                title: newTitle,
                updated_at: new Date(),
              })
            }
            updated++
          }
        }
      }
    }

    if (this.dryRun) {
      this.logger.info(`Would update ${updated} comic titles with year disambiguation`)
    } else {
      this.logger.success(`Updated ${updated} comic titles with year disambiguation`)
    }
  }
}
