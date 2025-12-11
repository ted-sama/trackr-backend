import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, manyToMany, computed, beforeSave } from '@adonisjs/lucid/orm'
import type { BelongsTo, ManyToMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Book from '#models/book'
import ContentFilterService from '#services/content_filter_service'

const parseStringArray = (value: unknown): string[] | null => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : null
    } catch {
      return null
    }
  }

  return null
}

const serializeStringArray = (value: string[] | null | undefined) => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

export default class List extends BaseModel {
  public static table = 'lists'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column({ serializeAs: null })
  declare userId: string | null

  @column({
    consume: (value) => parseStringArray(value),
    serialize: (value: string[] | null | undefined) => serializeStringArray(value),
    prepare: (value: string[] | null | undefined) => {
      if (!Array.isArray(value) || value.length === 0) {
        return null
      }
      return JSON.stringify(value)
    },
  })
  declare tags: string[] | null

  @column()
  declare isPublic: boolean

  @column({ serializeAs: null })
  declare isMyLibrary: boolean

  @column()
  declare backdropMode: string

  @column()
  declare backdropColor: string

  @column()
  declare backdropImage: string | null

  @column()
  declare ranked: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, {
    serializeAs: 'owner',
  })
  declare user: BelongsTo<typeof User>

  @manyToMany(() => Book, {
    pivotTable: 'list_books',
    pivotColumns: ['item_number', 'added_at', 'updated_at'],
    serializeAs: null,
  })
  declare bookItems: ManyToMany<typeof Book>

  @manyToMany(() => User, {
    pivotTable: 'list_likes',
    pivotTimestamps: {
      createdAt: 'created_at',
      updatedAt: false,
    },
    serializeAs: null,
  })
  declare likedBy: ManyToMany<typeof User>

  @manyToMany(() => User, {
    pivotTable: 'user_saved_lists',
    pivotTimestamps: {
      createdAt: 'created_at',
      updatedAt: false,
    },
    serializeAs: null,
  })
  declare savedBy: ManyToMany<typeof User>

  @computed()
  get books() {
    if (!this.$preloaded.bookItems) {
      return null
    }

    return {
      total: this.bookItems.length,
      items: this.bookItems.map((book) => book.serialize()),
    }
  }

  @computed()
  get likesCount() {
    if (!this.$preloaded.likedBy) {
      return 0
    }
    return this.likedBy.length
  }

  @computed()
  get savesCount() {
    if (!this.$preloaded.savedBy) {
      return 0
    }
    return this.savedBy.length
  }

  public isLikedBy(userId: string): boolean {
    if (!this.$preloaded.likedBy) {
      return false
    }
    return this.likedBy.some((user) => user.id === userId)
  }

  public isSavedBy(userId: string): boolean {
    if (!this.$preloaded.savedBy) {
      return false
    }
    return this.savedBy.some((user) => user.id === userId)
  }

  @beforeSave()
  static async validateContent(list: List) {
    // Validate and censor list name
    if (list.$dirty.name) {
      const nameCheck = ContentFilterService.validateAndCensor(list.name, 'list_name', {
        autoReject: false,
        autoCensor: true,
      })
      if (nameCheck.content !== list.name && list.userId) {
        await ContentFilterService.logModeration(
          list.userId,
          'list_name',
          list.name,
          nameCheck.content,
          nameCheck.reason!,
          list.id?.toString() ?? null
        )
        list.name = nameCheck.content
      }
    }

    // Validate and censor description
    if (list.$dirty.description && list.description) {
      const descCheck = ContentFilterService.validateAndCensor(
        list.description,
        'list_description',
        {
          autoReject: false,
          autoCensor: true,
        }
      )
      if (descCheck.content !== list.description && list.userId) {
        await ContentFilterService.logModeration(
          list.userId,
          'list_description',
          list.description,
          descCheck.content,
          descCheck.reason!,
          list.id?.toString() ?? null
        )
        list.description = descCheck.content
      }
    }

    // Validate and censor tags
    if (list.$dirty.tags && list.tags && list.tags.length > 0) {
      const censoredTags = list.tags.map((tag) => {
        const tagCheck = ContentFilterService.validateAndCensor(tag, 'list_tags', {
          autoReject: false,
          autoCensor: true,
        })
        return tagCheck.content
      })

      const hasChanges = censoredTags.some((tag, index) => tag !== list.tags![index])
      if (hasChanges && list.userId) {
        await ContentFilterService.logModeration(
          list.userId,
          'list_tags',
          JSON.stringify(list.tags),
          JSON.stringify(censoredTags),
          'profanity',
          list.id?.toString() ?? null
        )
        list.tags = censoredTags
      }
    }
  }
}
