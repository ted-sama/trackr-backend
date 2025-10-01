import { Exception } from '@adonisjs/core/exceptions'

type AppErrorOptions = {
  status?: number
  code: string
}

export default class AppError extends Exception {
  declare code: string

  constructor(message: string, { status = 400, code }: AppErrorOptions) {
    super(message, { status })
    this.code = code
  }
}
