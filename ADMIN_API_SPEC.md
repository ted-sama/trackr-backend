# Admin API Specification

## Goal
Create a secure admin API for Trackr with API key authentication (separate from user JWT auth).
Two API keys: one for Ted (human owner), one for Zango (AI assistant).

## Authentication

### New middleware: `admin_api_key_middleware.ts`
- Checks `X-Admin-API-Key` header
- Validates against env vars `ADMIN_API_KEY_TED` and `ADMIN_API_KEY_ZANGO`
- Rejects with 401 if invalid
- Adds `adminKeyOwner: 'ted' | 'zango'` to the HTTP context for audit logging

### Env vars to add:
```
ADMIN_API_KEY_TED=<generated secure key>
ADMIN_API_KEY_ZANGO=<generated secure key>
```

## Endpoints

All under `/admin/api/` prefix, protected by the new API key middleware.

### `GET /admin/api/users`
List all users with key info.
- Query params: `page`, `limit` (default 50), `sort` (created_at, username), `order` (asc/desc), `search` (filter by username/email)
- Response: paginated list with: id, username, displayName, email, avatar, role, plan, createdAt, isBanned, emailVerifiedAt
- Include computed fields: bookCount, reviewCount, listCount

### `GET /admin/api/users/:id`
Detailed user profile.
- Response: full user info + stats (book count by status, review count, list count, follower/following count, last activity date, registration date, subscription info)

### `GET /admin/api/stats`
Platform overview stats.
- totalUsers, totalBooks, totalTrackings, totalReviews, totalLists
- newUsersToday, newUsersThisWeek, newUsersThisMonth
- activeUsersToday (users with events today), activeUsersThisWeek
- topCountries (from recent signups if geo data available)

### `GET /admin/api/stats/growth`
Growth over time.
- Query params: `period` (day/week/month), `from`, `to`
- Response: array of { date, newUsers, activeUsers }

### `GET /admin/api/stats/retention`
Retention metrics.
- Response: { totalRegistered, activeLastDay, activeLastWeek, activeLastMonth, retentionRateWeek, retentionRateMonth }

### `GET /admin/api/activity`
Recent activity feed.
- Query params: `limit` (default 20), `type` (registration/import/tracking/review)
- Response: array of recent events across all users

### `GET /admin/api/top-manga`
Most popular manga/books.
- Query params: `limit` (default 20), `period` (all/week/month)
- Response: array of { book, trackingCount, averageRating, reviewCount }

## Implementation Notes
- Use Lucid ORM (not raw SQL) when possible, raw SQL for complex aggregations
- Follow existing code patterns from stats_controller.ts and moderations_controller.ts
- Create a single `admin_api_controller.ts` file
- Register routes in `start/routes.ts`
- Add the middleware to `start/kernel.ts` named middleware list
- Generate 2 secure random API keys and add them to `.env.example`
- Do NOT modify any existing files except routes.ts and kernel.ts
