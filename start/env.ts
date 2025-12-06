/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  // AWS
  AWS_ACCESS_KEY_ID: Env.schema.string(),
  AWS_SECRET_ACCESS_KEY: Env.schema.string(),
  AWS_REGION: Env.schema.string(),
  S3_BUCKET: Env.schema.string(),
  CDN_URL: Env.schema.string({ format: 'url' }),

  // Upstash Redis Cache
  UPSTASH_REDIS_REST_URL: Env.schema.string({ format: 'url' }),
  UPSTASH_REDIS_REST_TOKEN: Env.schema.string(),

  // Gemini
  GEMINI_API_KEY: Env.schema.string(),

  // OpenRouter
  OPENROUTER_API_KEY: Env.schema.string(),

  // Comic Vine API (for fetching comic covers)
  COMICVINE_API_KEY: Env.schema.string.optional(),

  // GCD (Grand Comics Database) paths
  GCD_DB_PATH: Env.schema.string.optional(),
  GCD_DOWNLOAD_DIR: Env.schema.string.optional(),

  // RevenueCat (Subscription Management)
  REVENUECAT_WEBHOOK_SECRET: Env.schema.string.optional(),
  REVENUECAT_PRODUCT_MONTHLY: Env.schema.string.optional(),
  REVENUECAT_PRODUCT_YEARLY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring the drive package
  |----------------------------------------------------------
  */
  DRIVE_DISK: Env.schema.enum(['fs', 's3'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring the mail package
  |----------------------------------------------------------
  */
  RESEND_API_KEY: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Frontend URL for password reset links
  |----------------------------------------------------------
  */
  FRONTEND_URL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring ally package
  |----------------------------------------------------------
  */
  GOOGLE_CLIENT_ID: Env.schema.string(),
  GOOGLE_CLIENT_SECRET: Env.schema.string(),
  GOOGLE_CALLBACK_URL: Env.schema.string.optional(),
})
