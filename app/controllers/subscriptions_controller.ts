import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import List from '#models/list'
import ChatBookUsage from '#models/chat_book_usage'
import env from '#start/env'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

// RevenueCat product IDs - Configure these in your .env or directly here
const PRODUCT_IDS = {
  MONTHLY: env.get('REVENUECAT_PRODUCT_MONTHLY', 'trackr_plus_monthly_sub'),
  YEARLY: env.get('REVENUECAT_PRODUCT_YEARLY', 'trackr_plus_yearly_sub'),
}

// Chat request limits per plan
export const CHAT_LIMITS = {
  FREE: 8,
  PLUS: 50,
}

interface RevenueCatEntitlement {
  product_identifier: string
  expires_at: string | null
  starts_at: string | null
  grace_period_expires_at: string | null
}

interface RevenueCatTransaction {
  product_id: string
  original_transaction_id: string
  transaction_id: string
  purchase_date: string
  price: number
  currency: string
}

interface RevenueCatWebhookEvent {
  event: {
    type: string
    app_user_id: string
    original_app_user_id: string
    transaction_id?: string
    entitlements?: RevenueCatEntitlement[]
    transaction?: RevenueCatTransaction
    cancel_reason?: string
    expiration_reason?: string
  }
  api_version?: string
  web_hook_version?: string
}

export default class SubscriptionsController {
  /**
   * @summary Get current user's subscription info
   * @tag Subscriptions
   * @description Returns the authenticated user's subscription status and details
   * @responseBody 200 - Subscription information
   * @responseBody 401 - Unauthorized
   */
  async show({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    const chatLimit = user.plan === 'plus' ? CHAT_LIMITS.PLUS : CHAT_LIMITS.FREE
    const chatRequestsUsed = user.chatRequestsCount ?? 0
    const chatRequestsRemaining = Math.max(0, chatLimit - chatRequestsUsed)

    return response.ok({
      plan: user.plan,
      isPremium: user.plan === 'plus',
      subscription: {
        status: user.subscriptionStatus,
        expiresAt: user.subscriptionExpiresAt,
        period: user.subscriptionPeriod,
      },
      chat: {
        limit: chatLimit,
        used: chatRequestsUsed,
        remaining: chatRequestsRemaining,
        resetsAt: user.chatRequestsResetAt,
      },
      features: {
        gifAvatar: user.plan === 'plus',
        imageBackdrop: user.plan === 'plus',
        stats: user.plan === 'plus',
        extendedChat: user.plan === 'plus',
      },
      pricing: {
        monthly: {
          price: 2.99,
          currency: 'EUR',
          productId: PRODUCT_IDS.MONTHLY,
        },
        yearly: {
          price: 24.99,
          currency: 'EUR',
          productId: PRODUCT_IDS.YEARLY,
          savings: '15%',
        },
      },
    })
  }

  /**
   * @summary Get current user's chat usage per book
   * @tag Subscriptions
   * @description Returns chat usage statistics per book for the authenticated user
   * @responseBody 200 - Chat usage statistics
   * @responseBody 401 - Unauthorized
   */
  async chatUsage({ auth, response }: HttpContext) {
    const user = await auth.authenticate()

    const chatLimit = user.plan === 'plus' ? CHAT_LIMITS.PLUS : CHAT_LIMITS.FREE
    const chatRequestsUsed = user.chatRequestsCount ?? 0
    const chatRequestsRemaining = Math.max(0, chatLimit - chatRequestsUsed)

    // Get per-book usage stats
    const bookUsage = await ChatBookUsage.getUserUsageStats(user.id, user.chatRequestsResetAt)

    return response.ok({
      summary: {
        limit: chatLimit,
        used: chatRequestsUsed,
        remaining: chatRequestsRemaining,
        resetsAt: user.chatRequestsResetAt,
        plan: user.plan,
      },
      books: bookUsage,
    })
  }

  /**
   * @summary RevenueCat Webhook handler
   * @tag Subscriptions
   * @description Receives and processes webhook events from RevenueCat
   * @responseBody 200 - Webhook processed successfully
   * @responseBody 401 - Unauthorized (invalid webhook secret)
   * @responseBody 404 - User not found
   */
  async webhook({ request, response, logger }: HttpContext) {
    // Verify webhook authorization - REQUIRED in production
    const authHeader = request.header('authorization')
    const webhookSecret = env.get('REVENUECAT_WEBHOOK_SECRET')

    if (!webhookSecret) {
      logger.error('[RevenueCat Webhook] REVENUECAT_WEBHOOK_SECRET is not configured')
      return response.internalServerError({ message: 'Webhook not configured' })
    }

    if (authHeader !== `Bearer ${webhookSecret}`) {
      return response.unauthorized({ message: 'Invalid webhook authorization' })
    }

    const payload = request.body() as RevenueCatWebhookEvent
    const { event } = payload

    logger.info(`[RevenueCat Webhook] Received event: ${event.type} for user: ${event.app_user_id}`)

    // Find user by app_user_id (which should be our user.id UUID)
    const user = await User.find(event.app_user_id)

    if (!user) {
      logger.warn(`[RevenueCat Webhook] User not found: ${event.app_user_id}`)
      // Return 200 anyway to acknowledge receipt - RevenueCat will retry on non-2xx
      return response.ok({ message: 'User not found, event acknowledged' })
    }

    try {
      await this.processWebhookEvent(user, event)
      return response.ok({ message: 'Webhook processed successfully' })
    } catch (error) {
      logger.error('[RevenueCat Webhook] Error processing event:', error)
      // Still return 200 to prevent retries on application errors
      return response.ok({ message: 'Webhook acknowledged with error' })
    }
  }

  /**
   * Process different webhook event types
   */
  private async processWebhookEvent(
    user: User,
    event: RevenueCatWebhookEvent['event']
  ): Promise<void> {
    switch (event.type) {
      case 'TEST':
        logger.info('[RevenueCat Webhook] Test event received')
        break

      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
        await this.handleSubscriptionActivation(user, event)
        break

      case 'CANCELLATION':
        await this.handleCancellation(user, event)
        break

      case 'EXPIRATION':
        await this.handleExpiration(user, event)
        break

      case 'BILLING_ISSUE':
        await this.handleBillingIssue(user, event)
        break

      case 'PRODUCT_CHANGE':
        await this.handleProductChange(user, event)
        break

      default:
        logger.info(`[RevenueCat Webhook] Unhandled event type: ${event.type}`)
    }
  }

  /**
   * Handle subscription activation (initial purchase, renewal, uncancellation)
   */
  private async handleSubscriptionActivation(
    user: User,
    event: RevenueCatWebhookEvent['event']
  ): Promise<void> {
    const entitlement = event.entitlements?.[0]
    const transaction = event.transaction

    // Debug logging for troubleshooting (redacted for security)
    logger.debug('[RevenueCat Webhook] Processing event', {
      type: event.type,
      hasEntitlements: !!event.entitlements?.length,
      hasTransaction: !!transaction,
    })

    // Determine subscription period from product ID
    let period: 'monthly' | 'yearly' | null = null
    if (transaction?.product_id) {
      if (
        transaction.product_id.includes('monthly') ||
        transaction.product_id === PRODUCT_IDS.MONTHLY
      ) {
        period = 'monthly'
      } else if (
        transaction.product_id.includes('yearly') ||
        transaction.product_id.includes('annual') ||
        transaction.product_id === PRODUCT_IDS.YEARLY
      ) {
        period = 'yearly'
      }
    }

    user.plan = 'plus'
    user.subscriptionStatus = 'active'
    user.subscriptionId = transaction?.original_transaction_id ?? event.transaction_id ?? null
    user.subscriptionPeriod = period

    if (entitlement?.expires_at) {
      user.subscriptionExpiresAt = DateTime.fromISO(entitlement.expires_at)
      logger.debug('[RevenueCat Webhook] Subscription expiration set')
    } else {
      logger.debug('[RevenueCat Webhook] No expires_at found in entitlements')
    }

    await user.save()

    logger.info(`[RevenueCat Webhook] Subscription activated for user, period: ${period}`)
  }

  /**
   * Handle cancellation (user cancelled but subscription still active until expiry)
   */
  private async handleCancellation(
    user: User,
    event: RevenueCatWebhookEvent['event']
  ): Promise<void> {
    const entitlement = event.entitlements?.[0]

    // Keep plan as 'plus' until actual expiration
    user.subscriptionStatus = 'cancelled'

    if (entitlement?.expires_at) {
      user.subscriptionExpiresAt = DateTime.fromISO(entitlement.expires_at)
    }

    await user.save()

    logger.info('[RevenueCat Webhook] Subscription cancelled')
  }

  /**
   * Handle subscription expiration
   */
  private async handleExpiration(
    user: User,
    _event: RevenueCatWebhookEvent['event']
  ): Promise<void> {
    user.plan = 'free'
    user.subscriptionStatus = 'expired'
    // Keep subscription info for reference but clear expiration
    user.subscriptionExpiresAt = null

    await user.save()

    // Clean up premium-only features
    await this.cleanupPremiumFeatures(user)

    logger.info('[RevenueCat Webhook] Subscription expired, premium features cleaned up')
  }

  /**
   * Clean up premium-only features when user downgrades to free plan
   * - Remove GIF avatars (set to null)
   * - Reset profile backdrop to color mode
   * - Reset all user's lists backdrops to color mode
   */
  private async cleanupPremiumFeatures(user: User): Promise<void> {
    let profileChanged = false

    // Check if avatar is a GIF and remove it
    if (user.avatar && this.isGifUrl(user.avatar)) {
      user.avatar = null
      profileChanged = true
      logger.debug('[Subscription Cleanup] Removed GIF avatar')
    }

    // Reset profile backdrop to color if it was using an image
    if (user.backdropMode === 'image' || user.backdropImage) {
      user.backdropMode = 'color'
      user.backdropImage = null
      profileChanged = true
      logger.debug('[Subscription Cleanup] Reset profile backdrop to color')
    }

    if (profileChanged) {
      await user.save()
    }

    // Reset all user's lists that have image backdrops
    const listsWithImageBackdrop = await List.query()
      .where('user_id', user.id)
      .where((query) => {
        query.where('backdrop_mode', 'image').orWhereNotNull('backdrop_image')
      })

    if (listsWithImageBackdrop.length > 0) {
      for (const list of listsWithImageBackdrop) {
        list.backdropMode = 'color'
        list.backdropImage = null
        await list.save()
      }
      logger.debug(`[Subscription Cleanup] Reset ${listsWithImageBackdrop.length} lists backdrops to color`)
    }
  }

  /**
   * Check if a URL points to a GIF image
   */
  private isGifUrl(url: string): boolean {
    const lowercaseUrl = url.toLowerCase()
    return lowercaseUrl.endsWith('.gif') || lowercaseUrl.includes('.gif?')
  }

  /**
   * Handle billing issue (payment failed, possibly in grace period)
   */
  private async handleBillingIssue(
    user: User,
    event: RevenueCatWebhookEvent['event']
  ): Promise<void> {
    const entitlement = event.entitlements?.[0]

    user.subscriptionStatus = 'billing_issue'

    // Keep expiration date from entitlement (might include grace period)
    if (entitlement?.expires_at) {
      user.subscriptionExpiresAt = DateTime.fromISO(entitlement.expires_at)
    }

    await user.save()

    logger.warn('[RevenueCat Webhook] Billing issue detected')
  }

  /**
   * Handle product change (upgrade/downgrade between monthly and yearly)
   */
  private async handleProductChange(
    user: User,
    event: RevenueCatWebhookEvent['event']
  ): Promise<void> {
    const transaction = event.transaction
    const entitlement = event.entitlements?.[0]

    if (transaction?.product_id) {
      if (
        transaction.product_id.includes('yearly') ||
        transaction.product_id.includes('annual') ||
        transaction.product_id === PRODUCT_IDS.YEARLY
      ) {
        user.subscriptionPeriod = 'yearly'
      } else {
        user.subscriptionPeriod = 'monthly'
      }
    }

    if (entitlement?.expires_at) {
      user.subscriptionExpiresAt = DateTime.fromISO(entitlement.expires_at)
    }

    await user.save()

    logger.info(`[RevenueCat Webhook] Product changed, new period: ${user.subscriptionPeriod}`)
  }

  /**
   * Check if user can make a chat request and increment counter
   * @returns true if allowed, false if limit reached
   */
  static async canMakeChatRequest(user: User): Promise<boolean> {
    const now = DateTime.now()

    // Check if we need to reset the counter (monthly reset)
    if (!user.chatRequestsResetAt || now > user.chatRequestsResetAt) {
      user.chatRequestsCount = 0
      user.chatRequestsResetAt = now.plus({ months: 1 }).startOf('month')
      await user.save()
    }

    const limit = user.plan === 'plus' ? CHAT_LIMITS.PLUS : CHAT_LIMITS.FREE

    return user.chatRequestsCount < limit
  }

  /**
   * Increment chat request counter
   */
  static async incrementChatRequest(user: User): Promise<void> {
    user.chatRequestsCount = (user.chatRequestsCount ?? 0) + 1
    await user.save()
  }
}
