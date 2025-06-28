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

router.get('/', async () => {
  return {
    hello: 'world',
  }
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
    router.get('/lists', [UsersController, 'showLists'])
    router.get('/library', [UsersController, 'showLibrary'])
  })
  .prefix('me')

router
  .group(() => {
    router.get('/', [BooksController, 'index'])
    router.get('/:id', [BooksController, 'show'])
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
    router.get('/:id', [ListsController, 'show'])
    // router.get('/:userId', [ListsController, 'indexByUser']) GET all lists by user
    router.post('/', [ListsController, 'create'])
    router.put('/:id', [ListsController, 'update'])
    router.delete('/:id', [ListsController, 'delete'])
    router.post('/:id/books', [ListsController, 'addBook'])
    router.delete('/:id/books', [ListsController, 'removeBook'])
    router.put('/:id/books/reorder', [ListsController, 'reorderList'])
    router.post('/:id/backdrop', [ListsController, 'uploadBackdropImage'])
  })
  .prefix('lists')

router
  .group(() => {
    router.get('/', [LibraryController, 'index'])
    router.post('/:bookId', [LibraryController, 'add'])
    router.delete('/:bookId', [LibraryController, 'remove'])
    router.patch('/:bookId', [LibraryController, 'update'])
  })
  .prefix('library')
