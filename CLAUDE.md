# Trackr Backend - Technical Documentation

## Overview

REST API built with AdonisJS v6 to power the Trackr application (book tracker).

**Link to global project**: See [../CLAUDE.md](../CLAUDE.md)

## Tech Stack

- **Framework**: AdonisJS 6.18.0
- **Runtime**: Node.js with TypeScript 5.8
- **Database**: PostgreSQL (via Lucid ORM)
- **Authentication**: @adonisjs/auth v9.4.0
- **Storage**: Cloudflare R2 via @adonisjs/drive
- **AI**: Google Gemini (@google/genai), OpenRouter
- **Cache**: Upstash Redis
- **Email**: @adonisjs/mail
- **Web Scraping**: Puppeteer, Axios, JSDOM
- **Validation**: VineJS (@vinejs/vine)
- **API Docs**: Adonis AutoSwagger

## Project Structure

```
trackr-backend/
├── app/
│   ├── controllers/         # HTTP Controllers
│   │   ├── auth_controller.ts
│   │   ├── books_controller.ts
│   │   ├── categories_controller.ts
│   │   ├── chats_controller.ts
│   │   ├── libraries_controller.ts
│   │   ├── lists_controller.ts
│   │   ├── moderations_controller.ts
│   │   ├── recap_controller.ts
│   │   ├── reports_controller.ts
│   │   ├── reviews_controller.ts
│   │   ├── stats_controller.ts
│   │   ├── subscriptions_controller.ts
│   │   └── users_controller.ts
│   │
│   ├── models/              # Lucid Models (ORM)
│   │   ├── user.ts
│   │   ├── book.ts
│   │   ├── book_tracking.ts
│   │   ├── book_review.ts
│   │   ├── book_review_revision.ts
│   │   ├── category.ts
│   │   ├── list.ts
│   │   ├── author.ts
│   │   ├── publisher.ts
│   │   ├── activity_log.ts
│   │   ├── moderated_content.ts
│   │   ├── report.ts
│   │   └── password_reset_token.ts
│   │
│   ├── middleware/          # Middleware
│   ├── validators/          # VineJS Validators
│   ├── services/            # Business Logic
│   ├── helpers/             # Utility Functions
│   └── exceptions/          # Custom Exceptions
│
├── database/
│   └── migrations/          # PostgreSQL Migrations
│
├── start/
│   └── routes.ts           # Route Definitions
│
├── config/                  # Configuration
├── docker-compose.yml       # Docker Configuration
└── .env                    # Environment Variables
```

## Path Aliases

The project uses the following import aliases:

```typescript
#controllers/*  → ./app/controllers/*.js
#models/*       → ./app/models/*.js
#validators/*   → ./app/validators/*.js
#services/*     → ./app/services/*.js
#helpers/*      → ./app/helpers/*.js
#middleware/*   → ./app/middleware/*.js
#exceptions/*   → ./app/exceptions/*.js
#database/*     → ./database/*.js
#config/*       → ./config/*.js
#providers/*    → ./providers/*.js
```

## Main Models

### User

- User authentication and profile
- Relations: books (tracking), reviews, lists, categories

### Book

- Book information (title, author, description, etc.)
- Relations: trackings, reviews, authors, publisher

### BookTracking

- Reading tracking per user
- Status: reading, completed, planned, dropped, etc.
- Progress (pages read, dates)

### BookReview

- Book reviews and ratings
- Relations: revisions (modification history)

### Category

- Custom categories per user
- Relations: books (many-to-many)

### List

- Custom reading lists
- Relations: books (many-to-many)

## API Routes

### Authentication (`/auth`)

```typescript
POST   /auth/register              # Registration
POST   /auth/login                 # Login
POST   /auth/forgot-password       # Password reset request
POST   /auth/reset-password        # Password reset
GET    /auth/google/redirect       # Google OAuth
GET    /auth/google/callback       # OAuth Callback
```

### Books (`/books`)

```typescript
GET    /books                      # List books
GET    /books/:id                  # Book details
POST   /books                      # Create book
PUT    /books/:id                  # Update book
DELETE /books/:id                  # Delete book
```

### Library (`/library`)

```typescript
GET    /library                    # User library
POST   /library                    # Add to library
PUT    /library/:id                # Update tracking
DELETE /library/:id                # Remove from library
```

### Reviews (`/reviews`)

```typescript
GET    /reviews                    # List reviews
GET    /reviews/:id                # Review details
POST   /reviews                    # Create review
PUT    /reviews/:id                # Update review
DELETE /reviews/:id                # Delete review
```

### Categories (`/categories`)

```typescript
GET    /categories                 # List categories
POST   /categories                 # Create category
PUT    /categories/:id             # Update category
DELETE /categories/:id             # Delete category
```

### Lists (`/lists`)

```typescript
GET    /lists                      # User lists
POST   /lists                      # Create list
PUT    /lists/:id                  # Update list
DELETE /lists/:id                  # Delete list
```

### Chat/AI (`/chat`)

```typescript
POST   /chat                       # AI conversation
```

### Stats (`/stats`)

```typescript
GET    /stats                      # User statistics
```

### Recap (`/recap`)

```typescript
GET    /recap                      # Reading recap
```

## Docker Configuration

### Environment Variables (.env)

```env
# Server
HOST=0.0.0.0
PORT=3333
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_DATABASE=trackr

# Cloudflare R2 Storage
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Google Gemini
GEMINI_API_KEY=

# OpenRouter (optional)
OPENROUTER_API_KEY=

# Mail
SMTP_HOST=
SMTP_PORT=
SMTP_USERNAME=
SMTP_PASSWORD=

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Docker Commands

```bash
# Start the stack
docker compose up --build

# Migrations run automatically on startup
# or manually:
docker compose run --rm app node build/ace.js migration:run --force

# Stop the stack
docker compose down

# Reset (with volume deletion)
docker compose down -v
```

## Local Development (without Docker)

```bash
# Installation
npm install

# Configure .env
cp .env.example .env
# Fill in environment variables

# Run migrations
node ace migration:run

# Development mode (with HMR)
npm run dev

# Production build
npm run build

# Start in production
npm start

# Tests
npm test

# Linting
npm run lint

# Formatting
npm run format

# Type checking
npm run typecheck
```

## Custom Ace Commands

```bash
# Migrations
node ace migration:run
node ace migration:rollback
node ace migration:fresh

# List routes
node ace list:routes

# Generate controller
node ace make:controller Books

# Generate model
node ace make:model Book

# Generate middleware
node ace make:middleware Auth

# Generate validator
node ace make:validator CreateBook
```

## API Documentation

Swagger documentation is generated automatically:

- **Swagger JSON/YAML**: `GET /swagger`
- **Swagger UI**: `GET /docs`

Configuration in `config/swagger.ts`.

## Main Services

### Authentication

- Token management
- Google OAuth
- Password reset via email

### Storage (Cloudflare R2)

- Book cover image uploads
- User avatar management
- Pre-signed URLs for access

### AI (Gemini/OpenRouter)

- Book recommendations
- Summary generation
- Conversational chat

### Cache (Upstash)

- Frequent query caching
- User sessions
- Rate limiting

## Best Practices

### Controllers

- Single responsibility per action
- Validation via VineJS
- Standardized JSON responses
- Appropriate error handling

### Models

- Well-defined Lucid relations
- Hooks for events (beforeSave, etc.)
- Serialization to hide sensitive data

### Middleware

- Authentication
- Authorization (policies)
- Input validation
- Rate limiting

### Services

- Complex business logic
- External API interactions
- Async processing

## Tests

```bash
# Run all tests
npm test

# Tests with watch
npm test -- --watch

# Test specific file
node ace test tests/functional/books.spec.ts
```

Test framework: Japa

## Security

- CORS configured (@adonisjs/cors)
- Strict input validation (VineJS)
- CSRF protection for forms
- Secure authentication tokens
- Sensitive environment variables
- Data sanitization

## Performance

- HMR (Hot Module Replacement) in dev
- Optimized TypeScript compilation (SWC)
- Caching with Upstash Redis
- Lazy loading of controllers
- Indexes on frequently queried columns

## Deployment

### Production with Docker

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Environment Variables in Production

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- Configure all API keys
- Use secure secrets

## Troubleshooting

### Database connection issues

- Check `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`
- Ensure PostgreSQL is running
- Verify credentials in docker-compose.yml

### Migration failures

- Check database connection
- Use `--force` in production
- Rollback if needed: `migration:rollback`

### Build errors

- Clean: `rm -rf build/`
- Rebuild: `npm run build`
- Check types: `npm run typecheck`

## Resources

- [AdonisJS Docs](https://docs.adonisjs.com/)
- [Lucid ORM](https://lucid.adonisjs.com/)
- [VineJS Validation](https://vinejs.dev/)
- [Global Project Documentation](../CLAUDE.md)
- [Frontend Mobile](../trackr-front-mobile/CLAUDE.md)

---

**To contribute to the backend, follow AdonisJS code conventions and ensure all tests pass before committing.**
