# Pinned Book Feature - Implementation Guide

## Overview

The "Pinned Book" feature allows Trackr Plus users to pin a favorite book to their home screen, showing:
- Book cover with gradient background (using the book's dominant color)
- Book title and author
- Reading progress bar (if tracking the book)
- AI-generated summary (optional)

## Back-end Implementation

### Database Changes

#### New Table: `pinned_books`
Located at: `database/migrations/1769876543210_create_pinned_books_table.ts`

| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| user_id | string (UUID) | Foreign key to users table |
| book_id | integer | Foreign key to books table |
| created_at | timestamp | Creation timestamp |
| updated_at | timestamp | Last update timestamp |

**Constraints:**
- Unique constraint on `(user_id)` - only one pinned book per user
- Foreign keys with `ON DELETE CASCADE`
- Indexes on `user_id` and `book_id`

### New Model: `PinnedBook`
Located at: `app/models/pinned_book.ts`

```typescript
// Properties
id: number
userId: string
bookId: number
createdAt: DateTime
updatedAt: DateTime

// Relations
user: BelongsTo<User>
book: BelongsTo<Book>
```

### New Controller: `PinnedBooksController`
Located at: `app/controllers/pinned_books_controller.ts`

#### API Endpoints

| Method | Route | Description | Auth Required | Plus Required |
|--------|-------|-------------|---------------|---------------|
| GET | `/me/pinned-book` | Get pinned book | Yes | No |
| GET | `/me/pinned-book/with-progress` | Get pinned book with reading progress | Yes | No |
| POST | `/me/pinned-book` | Pin a book | Yes | Yes |
| PATCH | `/me/pinned-book` | Update pinned book (e.g., add AI summary) | Yes | Yes |
| DELETE | `/me/pinned-book` | Remove pinned book | Yes | No |

### Validators
Located at: `app/validators/pinned_book_validator.ts`

- `pinBookValidator`: Validates `bookId` exists
- `updatePinnedBookValidator`: Validates optional `summary` field (max 2000 chars)

## Front-end Implementation

### New Hooks

#### `hooks/queries/pinnedBook.ts`
```typescript
// Query hooks
usePinnedBook() - Fetch current pinned book
usePinnedBookWithProgress() - Fetch pinned book with reading progress

// Mutation hooks
usePinBook() - Pin a book
useUpdatePinnedBook() - Update pinned book summary
useUnpinBook() - Remove pinned book
```

### New Component: `PinnedBookCard`
Located at: `components/book/PinnedBookCard.tsx`

**Features:**
- Gradient background using book's dominant color
- Book cover image
- Plus badge indicator
- Pin status indicator
- Reading progress bar (when tracking)
- AI summary display (when available)
- Unpin button

### Translations

Added keys to both `en.json` and `fr.json`:
- `pinnedBook.title`
- `pinnedBook.pinned`
- `pinnedBook.pinBook`
- `pinnedBook.unpinBook`
- `pinnedBook.plusOnly`
- `pinnedBook.aiSummary`
- `pinnedBook.readingProgress`
- `pinnedBook.noPinnedBook`
- `pinnedBook.tapToPin`

### Home Screen Integration
Updated `app/(tabs)/index.tsx` to show:
- PinnedBookCard for Trackr Plus users at the top of the home screen
- Empty state with call-to-action for users without a pinned book

## Database Migration

To apply the migration:

```bash
# Development
node ace migration:run

# Docker
docker compose run --rm app node build/ace.js migration:run --force
```

## API Response Examples

### GET /me/pinned-book/with-progress
```json
{
  "pinnedBook": {
    "id": 1,
    "bookId": 123,
    "summary": "In this chapter, John discovers...",
    "book": {
      "id": 123,
      "title": "The Great Adventure",
      "coverImage": "https://...",
      "authors": [{ "id": 1, "name": "John Doe" }],
      "publishers": [],
      "totalChapters": 100,
      "type": "novel",
      "dominantColor": "#FF6B6B"
    },
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  },
  "progress": {
    "status": "reading",
    "currentChapter": 45,
    "currentVolume": null,
    "lastReadAt": "2024-01-20T15:30:00Z",
    "totalChapters": 100,
    "progressPercentage": 45
  }
}
```

## Subscription Check

The premium check is implemented in the controller:

```typescript
if (!user.isPremium) {
  throw new AppError('Pinned Book is a Trackr Plus feature', {
    status: 403,
    code: 'PREMIUM_REQUIRED',
  })
}
```

## Error Handling

| Error Code | Status | Message |
|------------|--------|---------|
| PREMIUM_REQUIRED | 403 | Pinned Book is a Trackr Plus feature |
| Not found | 404 | Book not found / No pinned book found |

## Future Enhancements

1. **AI Summary Generation**: Integrate with existing AI services to auto-generate chapter summaries
2. **Multiple Pinned Books**: Allow pinning multiple books (scrollable card list)
3. **Widget Support**: Add home screen widget support
4. **Custom Ordering**: Allow reordering of pinned books
5. **Pinned Book Categories**: Group pinned books by status (currently reading, want to read, etc.)
