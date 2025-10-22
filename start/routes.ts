/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
const BooksController = () => import('#controllers/books_controller')
const CategoriesController = () => import('#controllers/categories_controller')
const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const ListsController = () => import('#controllers/lists_controller')
const LibraryController = () => import('#controllers/libraries_controller')
const RecapController = () => import('#controllers/recap_controller')
const ChatsController = () => import('#controllers/chats_controller')

import AutoSwagger from 'adonis-autoswagger'
import swagger from '#config/swagger'
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
    router.post('/register', [AuthController, 'register'])
    router.post('/login', [AuthController, 'login'])
  })
  .prefix('auth')

router
  .group(() => {
    router.get('/', [UsersController, 'me'])
    router.patch('/', [UsersController, 'update'])
    router.put('/avatar', [UsersController, 'uploadAvatar'])
    router.delete('/avatar', [UsersController, 'deleteAvatar'])
    router.put('/backdrop', [UsersController, 'uploadBackdropImage'])
    router.get('/lists', [UsersController, 'showLists'])
    router.get('/books', [LibraryController, 'index'])
    router.post('/books/:bookId', [LibraryController, 'add'])
    router.delete('/books/:bookId', [LibraryController, 'remove'])
    router.patch('/books/:bookId', [LibraryController, 'update'])
    router.get('/top', [UsersController, 'showTopBooks'])
    router.post('/top/:bookId', [LibraryController, 'addToTopBooks'])
    router.delete('/top/:bookId', [LibraryController, 'removeFromTopBooks'])
    router.put('/top/reorder', [UsersController, 'reorderTopBooks'])
    router.get('/activity', [UsersController, 'showMyActivity'])
  })
  .prefix('me')

router
  .group(() => {
    router.get('/:username', [UsersController, 'show'])
    router.get('/:username/top', [UsersController, 'showUserTopBooks'])
    router.get('/:username/lists', [UsersController, 'showUserLists'])
    router.get('/:username/activity', [UsersController, 'showUserActivity'])
  })
  .prefix('users')

router
  .group(() => {
    router.get('/', [BooksController, 'index'])
    router.get('/search', [BooksController, 'search'])
    router.get('/:id', [BooksController, 'show'])
    router.get('/:id/same', [BooksController, 'getBySameAuthor'])
    router.get('/:id/recap/:chapterId', [RecapController, 'recap'])
  })
  .prefix('books')

router
  .group(() => {
    router.get('/', [CategoriesController, 'index'])
    router.get('/:id', [CategoriesController, 'show'])
  })
  .prefix('categories')

router
  .group(() => {
    router.get('/', [ListsController, 'index'])
    router.get('/search', [ListsController, 'search'])
    router.get('/:id', [ListsController, 'show'])
    // router.get('/:userId', [ListsController, 'indexByUser']) GET all lists by user
    router.post('/', [ListsController, 'create'])
    router.patch('/:id', [ListsController, 'update'])
    router.delete('/:id', [ListsController, 'delete'])
    router.post('/:id/books', [ListsController, 'addBook'])
    router.delete('/:id/books', [ListsController, 'removeBook'])
    router.put('/:id/books/reorder', [ListsController, 'reorderList'])
    router.put('/:id/backdrop', [ListsController, 'uploadBackdropImage'])
  })
  .prefix('lists')

router
  .group(() => {
    router.post('/', [ChatsController, 'stream'])
  })
  .prefix('chat')
