# Feature: Rating Display in Book Reviews

## 📋 Overview

Les reviews de livres affichent maintenant la notation (rating) que l'utilisateur avait au moment de l'écriture de la review. Cette notation est automatiquement mise à jour lors de chaque révision de la review pour refléter la notation actuelle de l'utilisateur.

## 🔧 Changes Backend

### 1. Database Schema

Deux nouvelles colonnes ont été ajoutées à la table `book_reviews`:

```sql
ALTER TABLE book_reviews ADD COLUMN rating DECIMAL(3,1) NULL;
ALTER TABLE book_reviews ADD COLUMN revisions_count INTEGER NOT NULL DEFAULT 0;
```

**`rating`**:
- **Type**: `DECIMAL(3,1)` (permet des valeurs comme 7.5, 10.0, etc.)
- **Nullable**: Oui (pour les reviews existantes)

**`revisionsCount`**:
- **Type**: `INTEGER`
- **Default**: 0
- **Description**: Nombre de fois que la review a été révisée

### Table `book_review_revisions`

Une nouvelle colonne `rating` a été ajoutée :

```sql
ALTER TABLE book_review_revisions ADD COLUMN rating DECIMAL(3,1) NULL;
```

**`rating`**:
- **Type**: `DECIMAL(3,1)`
- **Nullable**: Oui
- **Description**: La note que l'utilisateur avait au moment de cette révision

### 2. API Response Changes

Tous les endpoints qui retournent des reviews incluent maintenant les champs `rating` et `revisionsCount`.

#### Endpoints affectés:

- `GET /books/:bookId/reviews` - Liste des reviews d'un livre
- `POST /books/:bookId/reviews` - Création d'une review
- `GET /books/:bookId/reviews/:id` - Détails d'une review
- `PATCH /books/:bookId/reviews/:id` - Mise à jour d'une review
- `GET /users/:username/reviews` - Reviews d'un utilisateur

#### Exemple de réponse:

```json
{
  "id": 123,
  "userId": "uuid-here",
  "bookId": 456,
  "content": "Great book! Really enjoyed the plot twists.",
  "rating": 8.5,
  "revisionsCount": 2,
  "likesCount": 42,
  "isLikedByMe": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-20T14:25:00.000Z",
  "user": {
    "id": "uuid-here",
    "username": "johndoe",
    "displayName": "John Doe",
    "avatar": "https://...",
    "plan": "premium"
  }
}
```

### 3. Business Logic

#### Lors de la création d'une review (`POST /books/:bookId/reviews`):
- La `rating` est automatiquement capturée depuis le `BookTracking` de l'utilisateur
- L'utilisateur DOIT avoir une notation pour créer une review (validation existante)
- La `rating` est enregistrée avec la review
- Le `revisionsCount` est initialisé à 0

#### Lors de la mise à jour d'une review (`PATCH /books/:bookId/reviews/:id`):
- L'ancien contenu ET l'ancienne note sont sauvegardés dans une révision
- La `rating` de la review est mise à jour avec la notation actuelle du `BookTracking`
- Le `revisionsCount` est incrémenté de 1
- Si l'utilisateur n'a plus de notation, une erreur 403 est retournée

## 🎨 Frontend Implementation Guide

### Step 1: Update TypeScript Types

```typescript
// types/review.ts

export interface BookReview {
  id: number
  userId: string
  bookId: number
  content: string
  rating: number | null  // ⬅️ NOUVEAU
  revisionsCount: number // ⬅️ NOUVEAU
  likesCount: number
  isLikedByMe: boolean
  createdAt: string
  updatedAt: string
  user: {
    id: string
    username: string
    displayName: string
    avatar: string | null
    plan: string
  }
  book?: {
    // ... book fields
  }
  revisions?: Array<{
    id: number
    content: string
    rating: number | null  // ⬅️ NOUVEAU - Rating au moment de cette révision
    createdAt: string
  }>
}

// Type pour les révisions
export interface BookReviewRevision {
  id: number
  reviewId: number
  content: string
  rating: number | null  // Rating que l'user avait à ce moment
  createdAt: string
}
```

### Step 2: Display Rating in Review Card

Afficher la notation de l'utilisateur à côté ou en haut de la review.

```tsx
// components/ReviewCard.tsx

import { Star } from 'lucide-react' // ou votre icône préférée

interface ReviewCardProps {
  review: BookReview
}

export function ReviewCard({ review }: ReviewCardProps) {
  return (
    <div className="review-card">
      <div className="review-header">
        <UserAvatar user={review.user} />
        <div className="review-meta">
          <span className="username">{review.user.displayName}</span>
          {review.rating && (
            <div className="review-rating">
              <Star className="star-icon" />
              <span className="rating-value">{review.rating}/10</span>
            </div>
          )}
          {review.revisionsCount > 0 && (
            <span className="revisions-badge" title={`Edited ${review.revisionsCount} time(s)`}>
              Edited
            </span>
          )}
        </div>
      </div>
      
      <div className="review-content">
        {review.content}
      </div>
      
      <div className="review-footer">
        <LikeButton review={review} />
        <span className="timestamp">
          {formatDate(review.createdAt)}
          {review.revisionsCount > 0 && ` • Edited`}
        </span>
      </div>
    </div>
  )
}
```

### Step 3: Handle Rating Display in Different Contexts

#### Option A: Badge Style
```tsx
<span className="rating-badge">
  ⭐ {review.rating}/10
</span>
```

#### Option B: Stars Visualization
```tsx
function RatingDisplay({ rating }: { rating: number }) {
  const filledStars = Math.floor(rating / 2) // Convert 0-10 to 0-5
  const hasHalfStar = (rating / 2) % 1 >= 0.5
  
  return (
    <div className="rating-stars">
      {[...Array(5)].map((_, i) => (
        <Star
          key={i}
          className={i < filledStars ? 'filled' : 'empty'}
        />
      ))}
      {hasHalfStar && <StarHalf className="half-filled" />}
      <span className="rating-text">{rating}/10</span>
    </div>
  )
}
```

#### Option C: Compact Inline Display
```tsx
<div className="review-header">
  <span className="username">{review.user.displayName}</span>
  <span className="separator">•</span>
  <span className="rating">{review.rating}/10</span>
  <span className="separator">•</span>
  <span className="date">{formatDate(review.createdAt)}</span>
</div>
```

### Step 4: Handle Missing Ratings (Legacy Reviews)

Les reviews existantes pourraient ne pas avoir de `rating` (valeur `null`).

```tsx
function ReviewRating({ rating }: { rating: number | null }) {
  if (!rating) {
    return null // Ne rien afficher pour les anciennes reviews
  }
  
  return (
    <div className="review-rating">
      <Star className="w-4 h-4" />
      <span>{rating}/10</span>
    </div>
  )
}
```

### Step 5: Update Review Form (Optional)

Si vous affichez la notation dans le formulaire de création/édition:

```tsx
function ReviewForm({ bookId, existingReview }: ReviewFormProps) {
  const { data: tracking } = useBookTracking(bookId)
  
  return (
    <form>
      {tracking?.rating && (
        <div className="form-info">
          <p>Your current rating: <strong>{tracking.rating}/10</strong></p>
          <p className="text-sm text-gray-500">
            This rating will be saved with your review
          </p>
        </div>
      )}
      
      <textarea
        placeholder="Write your review..."
        // ...
      />
      
      <button type="submit">
        {existingReview ? 'Update Review' : 'Publish Review'}
      </button>
    </form>
  )
}
```

### Step 6: Show Revisions Count and History

#### Option A: Simple "Edited" Badge

```tsx
function ReviewCard({ review }: ReviewCardProps) {
  return (
    <div className="review-card">
      {/* ... header ... */}
      <div className="review-footer">
        <LikeButton review={review} />
        <span className="timestamp">
          {formatDate(review.createdAt)}
          {review.revisionsCount > 0 && (
            <span className="edited-indicator">
              • Edited {review.revisionsCount > 1 ? `${review.revisionsCount} times` : ''}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
```

#### Option B: Clickable Revisions Count

```tsx
function ReviewCard({ review }: ReviewCardProps) {
  const [showRevisions, setShowRevisions] = useState(false)
  
  return (
    <div className="review-card">
      {/* ... header and content ... */}
      <div className="review-footer">
        <LikeButton review={review} />
        {review.revisionsCount > 0 && (
          <button
            onClick={() => setShowRevisions(!showRevisions)}
            className="revisions-button"
          >
            View {review.revisionsCount} {review.revisionsCount === 1 ? 'revision' : 'revisions'}
          </button>
        )}
      </div>
      
      {showRevisions && review.revisions && (
        <RevisionHistory revisions={review.revisions} />
      )}
    </div>
  )
}
```

#### Option C: Detailed Revision History

Si vous affichez l'historique des révisions complet:

```tsx
function ReviewRevisionHistory({ review }: { review: BookReview }) {
  return (
    <div className="revision-history">
      <h3>Revision History ({review.revisionsCount} {review.revisionsCount === 1 ? 'revision' : 'revisions'})</h3>
      
      {/* Version actuelle */}
      <div className="current-version">
        <div className="revision-header">
          <span className="badge-current">Current</span>
          <span>{formatDate(review.updatedAt)}</span>
          {review.rating && <span className="rating">⭐ {review.rating}/10</span>}
        </div>
        <div className="revision-content">
          {review.content}
        </div>
      </div>
      {/* Versions précédentes avec leur rating */}
      {review.revisions?.map((revision, index) => (
        <div key={revision.id} className="revision-item">
          <div className="revision-header">
            <span>Revision {review.revisions.length - index}</span>
            <span>{formatDate(revision.createdAt)}</span>
            {revision.rating && <span className="rating">⭐ {revision.rating}/10</span>}
          </div>
          <div className="revision-content">
            {revision.content}
          </div>
          {/* Afficher si le rating a changé par rapport à la version suivante */}
          {index > 0 && revision.rating !== review.revisions[index - 1]?.rating && (
            <span className="rating-changed-badge">Rating changed</span>
          )}
        </div>
      ))}
    </div>
  )
}
```

#### Comparaison des ratings entre révisions

Vous pouvez mettre en évidence les changements de rating :

```tsx
function RatingChange({ oldRating, newRating }: { oldRating: number | null, newRating: number | null }) {
  if (oldRating === newRating) return null
  
  const diff = (newRating ?? 0) - (oldRating ?? 0)
  const isIncrease = diff > 0
  
  return (
    <span className={`rating-change ${isIncrease ? 'text-green-500' : 'text-red-500'}`}>
      {isIncrease ? '↑' : '↓'} {Math.abs(diff).toFixed(1)}
    </span>
  )
}
```

### Step 7: Display Revisions Count Badge

Pour afficher le nombre de révisions de manière discrète:

```tsx
// Simple badge
<div className="flex items-center gap-2">
  {review.revisionsCount > 0 && (
    <span className="text-xs text-gray-500">
      Edited {review.revisionsCount}x
    </span>
  )}
</div>

// Tooltip badge (avec une bibliothèque comme Radix UI)
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger>
      <span className="text-xs bg-gray-100 px-2 py-1 rounded">
        Edited
      </span>
    </TooltipTrigger>
    <TooltipContent>
      {review.revisionsCount} {review.revisionsCount === 1 ? 'revision' : 'revisions'}
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```
```

## 🎯 UX Recommendations

### 1. **Prominent but Not Overwhelming**
- La notation devrait être visible mais ne pas dominer la review
- Utilisez une taille de police légèrement plus petite que le username
- Suggestion: Placer entre le username et le contenu de la review

### 2. **Visual Consistency**
- Utilisez la même visualisation de rating que dans BookTracking
- Si vous utilisez des étoiles ailleurs, utilisez-les ici aussi
- Gardez la même échelle (0-10) partout dans l'app

### 3. **Handle Edge Cases**
```tsx
// Reviews anciennes sans rating
{review.rating ? (
  <RatingDisplay rating={review.rating} />
) : null}

// Rating égal à 0 (valide!)
{review.rating !== null && (
  <RatingDisplay rating={review.rating} />
)}

// Reviews sans révisions
{review.revisionsCount > 0 && (
  <span className="edited-badge">Edited</span>
)}
```

### 4. **Mobile Responsiveness**
```tsx
// Desktop: Rating à côté du username
<div className="flex items-center gap-2">
  <span>{user.displayName}</span>
  <span>•</span>
  <RatingDisplay rating={review.rating} />
</div>

// Mobile: Rating en dessous
<div className="flex flex-col gap-1">
  <span>{user.displayName}</span>
  <RatingDisplay rating={review.rating} />
</div>
```

### 5. **Accessibility**
```tsx
<div className="review-rating" aria-label={`Rating: ${rating} out of 10`}>
  <Star aria-hidden="true" />
  <span>{rating}/10</span>
</div>

{review.revisionsCount > 0 && (
  <span 
    className="edited-badge"
    aria-label={`This review has been edited ${review.revisionsCount} time(s)`}
  >
    Edited
  </span>
)}
```

## 🔍 Testing Checklist

### Rating
- [ ] Les nouvelles reviews affichent correctement la notation
- [ ] Les reviews mises à jour affichent la notation actualisée
- [ ] Les anciennes reviews (rating = null) ne causent pas d'erreur
- [ ] La notation s'affiche correctement sur mobile et desktop
- [ ] La notation est accessible (lecteurs d'écran)
- [ ] Les différentes vues (liste, détail, user profile) affichent tous la notation
- [ ] Un rating de 0 est correctement affiché (edge case)
- [ ] Un rating de 10.0 est correctement affiché

### Revisions Count
- [ ] Les nouvelles reviews affichent `revisionsCount: 0`
- [ ] Le compteur s'incrémente correctement après chaque mise à jour
- [ ] Le badge "Edited" apparaît seulement quand `revisionsCount > 0`
- [ ] Le compteur correspond au nombre réel de révisions dans la base de données
- [ ] L'indicateur "Edited" est visible sur mobile et desktop
- [ ] Le tooltip/aria-label indique le nombre exact de révisions

## 📝 Example Styling (Tailwind CSS)

```tsx
<div className="flex items-center gap-2 text-sm text-gray-600">
  <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
  <span className="font-medium">{review.rating}/10</span>
</div>
```

```tsx
<div className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-50 text-yellow-700 rounded-full text-xs font-medium">
  <Star className="w-3 h-3 fill-current" />
  {review.rating}
</div>
```

**Revisions Count Badge:**

```tsx
// Simple badge
{review.revisionsCount > 0 && (
  <span className="text-xs text-gray-500 italic">
    Edited {review.revisionsCount > 1 ? `${review.revisionsCount}x` : ''}
  </span>
)}
```

```tsx
// Subtle badge
{review.revisionsCount > 0 && (
  <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
    <Edit2 className="w-3 h-3" />
    <span>Edited</span>
  </div>
)}
```

## 🚀 Migration Notes

### Backend Migration
```bash
# Run the migration
node ace migration:run
```

### Frontend Migration
- **Breaking Change**: Non (les champs `rating` et `revisionsCount` sont ajoutés, pas de suppression)
- **Backward Compatible**: Oui (rating peut être null, revisionsCount est 0 par défaut)
- **Required Changes**: Mettre à jour les types TypeScript
- **Optional Changes**: 
  - Afficher la notation dans l'UI
  - Afficher le badge "Edited" pour les reviews révisées
  - Afficher le nombre de révisions

## 📞 Support

Pour toute question sur cette feature:
- Backend: Vérifier `app/controllers/reviews_controller.ts`
- Database: Migration `1765579206662_create_add_rating_to_book_reviews_table.ts`
- Model: `app/models/book_review.ts`

## 🔄 Related Features

- BookTracking rating system
- Review revisions history
- User profile reviews list

