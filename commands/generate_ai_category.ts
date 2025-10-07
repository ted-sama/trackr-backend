import Book from '#models/book'
import Category from '#models/category'
import { aiTranslate } from '#helpers/ai_translate'
import { GoogleGenAI } from '@google/genai'
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class GenerateAiCategory extends BaseCommand {
  static commandName = 'category:generate'
  static description = 'Generate a new category with mangas using AI'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Generating AI category...')

    const genai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY,
    })

    const result = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Imagine a manga category (e.g. Classic Shonen, Timeless Classics, Isekai, Sci-Fi Adventures, Dungeons & Dragons, Best Shonen Jump Manga, etc.), be creative on themes but keep the titles classic and simple and return a strict JSON object in ENGLISH for title and description:
{
  "title": "Category title in English",
  "description": "Concise category description in English",
  "books": ["Manga title 1", "Manga title 2", ...]
}

IMPORTANT: Provide EXACTLY 10-12 manga titles maximum. Use EXACT official manga titles (e.g. "One Piece", "Naruto", "Berserk") to ensure accurate matching.`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    })

    let categoryIdea: { title?: string; description?: string | null; books?: string[] } = {}
    try {
      categoryIdea = JSON.parse(result.text || '{}')
    } catch (e) {
      this.logger.error('Failed to parse AI JSON response')
      return
    }

    const proposedTitle = (categoryIdea.title || '').trim()
    const proposedDescription = (categoryIdea.description || '').trim()
    const proposedBooks = Array.isArray(categoryIdea.books)
      ? categoryIdea.books.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : []

    if (!proposedTitle || proposedBooks.length === 0) {
      this.logger.error('Invalid response from AI: missing title or books')
      return
    }

    this.logger.info(`AI suggested category: ${proposedTitle}`)
    this.logger.info(`Searching for ${proposedBooks.length} candidate book titles...`)

    const normalizedCandidates = proposedBooks.map((t) => t.trim().toLowerCase())

    // Fetch candidate books with stricter matching
    const candidateBooks = await Book.query().where((query) => {
      for (const candidate of normalizedCandidates) {
        query.orWhere((sub) => {
          sub
            // Exact title match (highest priority)
            .whereRaw('LOWER(title) = ?', [candidate])
            // Exact match in alternative titles
            .orWhereRaw(
              `EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(alternative_titles::jsonb, '[]'::jsonb)) AS alt_title
                WHERE LOWER(alt_title) = ?
              )`,
              [candidate]
            )
            // Only allow partial matches if they start with the candidate (more restrictive)
            .orWhereRaw('LOWER(title) LIKE ?', [`${candidate}%`])
        })
      }
    })

    // Score and sort books by match quality
    const scoredBooks = candidateBooks.map((book) => {
      const titleLower = book.title.toLowerCase()
      const altTitles = (book.alternativeTitles || []).map((t: string) => t.toLowerCase())

      let score = 0

      // Exact match in title (highest priority)
      if (normalizedCandidates.includes(titleLower)) {
        score = 100
      }
      // Exact match in alternative titles
      else if (altTitles.some((alt: string) => normalizedCandidates.includes(alt))) {
        score = 90
      }
      // Partial match at start of title
      else if (normalizedCandidates.some((c) => titleLower.startsWith(c))) {
        score = 50
      }

      return { book, score }
    })

    // Sort by score (desc) then by rating (desc), limit to 20
    const books = scoredBooks
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return (b.book.rating || 0) - (a.book.rating || 0)
      })
      .slice(0, 20) // Maximum 20 books per category
      .map((item) => item.book)

    if (books.length === 0) {
      this.logger.info('No books found for this category')
      return
    }

    this.logger.info(`Found ${books.length} books`)

    // Translations to French
    const titleFrRaw = await aiTranslate(proposedTitle, 'fr')
    const titleFr = titleFrRaw.trim()
    const descriptionEn = proposedDescription.length > 0 ? proposedDescription : null
    let descriptionFr: string | null = null
    if (descriptionEn) {
      const descriptionFrRaw = await aiTranslate(descriptionEn, 'fr')
      descriptionFr = descriptionFrRaw.trim()
    }

    let category = await Category.query().where('title', proposedTitle).first()
    if (!category) {
      category = await Category.create({
        title: proposedTitle,
        titleFr: titleFr || null,
        description: descriptionEn,
        descriptionFr: descriptionFr || null,
        isFeatured: true,
      })
      this.logger.info(`Created new category "${category.title}"`)
    } else {
      category.merge({
        title: proposedTitle,
        titleFr: titleFr || category.titleFr,
        description: descriptionEn ?? category.description,
        descriptionFr: descriptionFr || category.descriptionFr,
        isFeatured: true,
      })
      await category.save()
      this.logger.info(`Updated existing category "${category.title}"`)
    }

    // Fetch already attached ids to avoid duplicate pivot inserts
    const existing = await category.related('books').query().select('books.id')
    const existingIds = new Set(existing.map((b) => b.id))
    const toAttach = books.map((b) => b.id).filter((id) => !existingIds.has(id))

    if (toAttach.length > 0) {
      await category.related('books').attach(toAttach)
    }

    this.logger.info(
      `Category "${category.title}" now has +${toAttach.length} attached (total requested: ${books.length}).`
    )
  }
}
