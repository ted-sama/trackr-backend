/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
const BooksController = () => import('#controllers/books_controller')
const CategoriesController = () => import('#controllers/categories_controller')
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const ListsController = () => import('#controllers/lists_controller')
const LibraryController = () => import('#controllers/libraries_controller')
const RecapController = () => import('#controllers/recap_controller')
const ChatsController = () => import('#controllers/chats_controller')
const StatsController = () => import('#controllers/stats_controller')
const SubscriptionsController = () => import('#controllers/subscriptions_controller')
const ReportsController = () => import('#controllers/reports_controller')
const ReviewsController = () => import('#controllers/reviews_controller')
const ModerationsController = () => import('#controllers/moderations_controller')
const NotificationsController = () => import('#controllers/notifications_controller')
const GenresController = () => import('#controllers/genres_controller')
const FollowsController = () => import('#controllers/follows_controller')
const FeedController = () => import('#controllers/feed_controller')

import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'

// Health check endpoint
router.get('/health', async ({ response }) => {
  return response.ok({ status: 'ok' })
})

// returns swagger in YAML
router.get('/swagger', async () => {
  return AutoSwagger.default.docs(router.toJSON(), swagger)
})

// Renders Swagger-UI and passes YAML-output of /swagger
router.get('/docs', async () => {
  return AutoSwagger.default.ui('/swagger', swagger)
  // return AutoSwagger.default.scalar("/swagger"); to use Scalar instead. If you want, you can pass proxy url as second argument here.
  // return AutoSwagger.default.rapidoc("/swagger", "view"); to use RapiDoc instead (pass "view" default, or "read" to change the render-style)
})

router
  .group(() => {
    router
      .post('/register', [AuthController, 'register'])
      .use(middleware.rateLimit({ limitType: 'register' }))
    router
      .post('/login', [AuthController, 'login'])
      .use(middleware.rateLimit({ limitType: 'login' }))
    router
      .post('/check-email', [AuthController, 'checkEmail'])
      .use(middleware.rateLimit({ limitType: 'check-email' }))
    router.post('/verify-email', [AuthController, 'verifyEmail'])
    router
      .post('/resend-verification', [AuthController, 'resendVerification'])
      .use(middleware.rateLimit({ limitType: 'resend-verification' }))
    router
      .post('/forgot-password', [AuthController, 'forgotPassword'])
      .use(middleware.rateLimit({ limitType: 'forgot-password' }))
    router.post('/reset-password', [AuthController, 'resetPassword'])
    router.post('/change-password', [AuthController, 'changePassword'])
    router
      .post('/refresh', [AuthController, 'refresh'])
      .use(middleware.rateLimit({ limitType: 'refresh' }))
    router.post('/logout', [AuthController, 'logout']).use(middleware.auth())
    router.get('/google/redirect', [AuthController, 'googleRedirect'])
    router.get('/google/callback', [AuthController, 'googleCallback'])
  })
  .prefix('auth')

router
  .group(() => {
    router.get('/', [UsersController, 'me'])
    router.patch('/', [UsersController, 'update'])
    router.delete('/', [UsersController, 'deleteAccount'])
    router.put('/avatar', [UsersController, 'uploadAvatar'])
    router.delete('/avatar', [UsersController, 'deleteAvatar'])
    router.put('/backdrop', [UsersController, 'uploadBackdropImage'])
    router.get('/lists', [UsersController, 'showLists'])
    router.get('/books', [LibraryController, 'index'])
    router.post('/books/:bookId', [LibraryController, 'add'])
    router.delete('/books/:bookId', [LibraryController, 'remove'])
    router.patch('/books/:bookId', [LibraryController, 'update'])
    router.post('/books/:bookId/pin', [LibraryController, 'togglePin'])
    router.post('/books/import/mal', [LibraryController, 'importFromMal'])
    router.post('/books/import/mal/fetch', [LibraryController, 'fetchFromMalUsername'])
    router.post('/books/import/mal/confirm', [LibraryController, 'confirmMalImport'])
    router.get('/top', [UsersController, 'showTopBooks'])
    router.post('/top/:bookId', [LibraryController, 'addToTopBooks'])
    router.delete('/top/:bookId', [LibraryController, 'removeFromTopBooks'])
    router.put('/top/reorder', [UsersController, 'reorderTopBooks'])
    router.get('/activity', [UsersController, 'showMyActivity'])
    router.get('/stats', [StatsController, 'index'])
    router.get('/stats/books', [StatsController, 'getFilteredBooks'])
    router.get('/subscription', [SubscriptionsController, 'show'])
    router.get('/chat-usage', [SubscriptionsController, 'chatUsage'])
    router.post('/push-token', [UsersController, 'registerPushToken'])
    router.get('/notification-settings', [UsersController, 'getNotificationSettings'])
    router.patch('/notification-settings', [UsersController, 'updateNotificationSettings'])
    router.get('/followers', [FollowsController, 'getMyFollowers'])
    router.get('/following', [FollowsController, 'getMyFollowing'])
    router.get('/pinned-book', [UsersController, 'getPinnedBook'])
    router.post('/pinned-book/:bookId', [UsersController, 'setPinnedBook'])
    router.delete('/pinned-book', [UsersController, 'removePinnedBook'])
  })
  .prefix('me')
  .use([middleware.auth(), middleware.banned()])

router
  .group(() => {
    router.get('/search', [UsersController, 'search'])
    router.get('/:username', [UsersController, 'show'])
    router.get('/:username/top', [UsersController, 'showUserTopBooks'])
    router.get('/:username/lists', [UsersController, 'showUserLists'])
    router.get('/:username/activity', [UsersController, 'showUserActivity'])
    router.get('/:username/stats', [StatsController, 'showUserStats'])
    router.get('/:username/stats/books', [StatsController, 'getFilteredBooksForUser'])
    router.get('/:username/books', [LibraryController, 'showUserBooks'])
    router.get('/:username/reviews', [ReviewsController, 'userReviews'])
    router.post('/:username/follow', [FollowsController, 'follow'])
    router.delete('/:username/follow', [FollowsController, 'unfollow'])
    router.get('/:username/followers', [FollowsController, 'getFollowers'])
    router.get('/:username/following', [FollowsController, 'getFollowing'])
  })
  .prefix('users')

router
  .group(() => {
    router.get('/', [BooksController, 'index'])
    router.get('/search', [BooksController, 'search'])
    router.get('/popular', [BooksController, 'popular'])
    router.get('/:id', [BooksController, 'show'])
    router.get('/:id/same', [BooksController, 'getBySame'])
    router.get('/:id/readers', [BooksController, 'getReaders'])
    router.get('/:id/recap/:chapterId', [RecapController, 'recap'])
    router.get('/:bookId/reviews', [ReviewsController, 'index'])
    router.get('/:bookId/reviews/me', [ReviewsController, 'myReview'])
    router.post('/:bookId/reviews', [ReviewsController, 'store'])
    router.get('/:bookId/reviews/:id', [ReviewsController, 'show'])
    router.patch('/:bookId/reviews/:id', [ReviewsController, 'update'])
    router.delete('/:bookId/reviews/:id', [ReviewsController, 'destroy'])
    router.post('/:bookId/reviews/:id/like', [ReviewsController, 'like'])
    router.delete('/:bookId/reviews/:id/like', [ReviewsController, 'unlike'])
  })
  .prefix('books')

router
  .group(() => {
    router.get('/', [CategoriesController, 'index'])
    router.get('/:id', [CategoriesController, 'show'])
  })
  .prefix('categories')

// Lists - public routes for reading, auth+banned check for mutations
router.get('/lists', [ListsController, 'index'])
router.get('/lists/search', [ListsController, 'search'])
router.get('/lists/:id', [ListsController, 'show'])

router
  .group(() => {
    router.post('/', [ListsController, 'create'])
    router.patch('/:id', [ListsController, 'update'])
    router.delete('/:id', [ListsController, 'delete'])
    router.post('/:id/books', [ListsController, 'addBook'])
    router.delete('/:id/books', [ListsController, 'removeBook'])
    router.put('/:id/books/reorder', [ListsController, 'reorderList'])
    router.put('/:id/backdrop', [ListsController, 'uploadBackdropImage'])
    router.post('/:id/like', [ListsController, 'like'])
    router.delete('/:id/like', [ListsController, 'unlike'])
    router.post('/:id/save', [ListsController, 'saveList'])
    router.delete('/:id/save', [ListsController, 'unsaveList'])
  })
  .prefix('lists')
  .use([middleware.auth(), middleware.banned()])

router
  .group(() => {
    router.post('/:bookId', [ChatsController, 'stream'])
  })
  .prefix('chat')
  .use([middleware.auth(), middleware.banned()])

// Reports (requires authentication + not banned)
router
  .group(() => {
    router.post('/', [ReportsController, 'create'])
    router.get('/my', [ReportsController, 'myReports'])
    router.delete('/:id', [ReportsController, 'delete'])
  })
  .prefix('reports')
  .use([middleware.auth(), middleware.banned()])

// Notifications (auth required, but banned users can still read notifications)
router
  .group(() => {
    router.get('/', [NotificationsController, 'index'])
    router.get('/unread-count', [NotificationsController, 'unreadCount'])
    router.patch('/:id/read', [NotificationsController, 'markAsRead'])
    router.post('/read-all', [NotificationsController, 'markAllAsRead'])
  })
  .prefix('notifications')
  .use([middleware.auth()])

// Genres
router
  .group(() => {
    router.get('/translations', [GenresController, 'translations'])
  })
  .prefix('genres')

// Feed (personalized content based on following)
router
  .group(() => {
    router.get('/popular-among-following', [FeedController, 'popularAmongFollowing'])
    router.get('/recently-rated', [FeedController, 'recentlyRated'])
  })
  .prefix('feed')
  .use([middleware.auth(), middleware.banned()])

// Webhooks (no auth required - verified via webhook secret)
router
  .group(() => {
    router.post('/revenuecat', [SubscriptionsController, 'webhook'])
  })
  .prefix('webhooks')

// Admin Moderation routes (requires admin role)
router
  .group(() => {
    // Dashboard
    router.get('/dashboard', [ModerationsController, 'dashboard'])

    // Reports
    router.get('/reports', [ModerationsController, 'allReports'])
    router.get('/reports/pending', [ModerationsController, 'pendingReports'])
    router.get('/reports/stats', [ModerationsController, 'reportStats'])
    router.patch('/reports/:id', [ModerationsController, 'reviewReport'])

    // Moderated Content
    router.get('/moderated-content', [ModerationsController, 'moderatedContent'])

    // User Management
    router.get('/users/:userId/summary', [ModerationsController, 'userModerationSummary'])
    router.get('/users/:userId/strikes', [ModerationsController, 'userStrikes'])
    router.post('/users/:userId/strike', [ModerationsController, 'addStrike'])
    router.delete('/users/:userId/strikes/:strikeId', [ModerationsController, 'removeStrike'])
    router.delete('/users/:userId/strikes', [ModerationsController, 'clearStrikes'])
    router.post('/users/:userId/ban', [ModerationsController, 'banUser'])
    router.post('/users/:userId/unban', [ModerationsController, 'unbanUser'])
  })
  .prefix('admin/moderation')
  .use([middleware.auth(), middleware.admin()])
