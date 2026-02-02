/**
 * Database Maintenance Scheduler
 *
 * This file sets up scheduled maintenance tasks for the database.
 * It can be enabled by setting SCHEDULER_ENABLED=true in your .env file.
 *
 * IMPORTANT: In production, consider using external schedulers instead:
 * - System cron jobs (crontab)
 * - Kubernetes CronJobs
 * - Cloud schedulers (AWS EventBridge, GCP Cloud Scheduler)
 *
 * This internal scheduler is suitable for:
 * - Development environments
 * - Single-instance deployments
 * - Simple setups where external cron is not available
 *
 * For multi-instance deployments, use external schedulers to avoid
 * running the same task multiple times.
 */

import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import DatabaseMaintenanceService from '#services/database_maintenance_service'

// Time constants
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

// Configuration
const SCHEDULER_ENABLED = env.get('SCHEDULER_ENABLED', 'false') === 'true'

// Schedule configuration (in hours from midnight UTC)
const DAILY_MAINTENANCE_HOUR = 3 // 3:00 AM UTC
const WEEKLY_MAINTENANCE_DAY = 0 // Sunday
const MONTHLY_MAINTENANCE_DAY = 1 // 1st of the month

interface SchedulerState {
  lastDailyRun: Date | null
  lastWeeklyRun: Date | null
  lastMonthlyRun: Date | null
  isRunning: boolean
}

const state: SchedulerState = {
  lastDailyRun: null,
  lastWeeklyRun: null,
  lastMonthlyRun: null,
  isRunning: false,
}

/**
 * Check if we should run daily maintenance
 */
function shouldRunDaily(): boolean {
  const now = new Date()
  const currentHour = now.getUTCHours()

  // Only run at the scheduled hour
  if (currentHour !== DAILY_MAINTENANCE_HOUR) {
    return false
  }

  // Check if we already ran today
  if (state.lastDailyRun) {
    const lastRunDate = state.lastDailyRun.toISOString().split('T')[0]
    const todayDate = now.toISOString().split('T')[0]
    if (lastRunDate === todayDate) {
      return false
    }
  }

  return true
}

/**
 * Check if we should run weekly maintenance
 */
function shouldRunWeekly(): boolean {
  const now = new Date()
  const currentDay = now.getUTCDay()
  const currentHour = now.getUTCHours()

  // Only run on scheduled day and hour
  if (currentDay !== WEEKLY_MAINTENANCE_DAY || currentHour !== DAILY_MAINTENANCE_HOUR) {
    return false
  }

  // Check if we already ran this week
  if (state.lastWeeklyRun) {
    const weekAgo = new Date(now.getTime() - 6 * 24 * HOUR)
    if (state.lastWeeklyRun > weekAgo) {
      return false
    }
  }

  return true
}

/**
 * Check if we should run monthly maintenance
 */
function shouldRunMonthly(): boolean {
  const now = new Date()
  const currentDate = now.getUTCDate()
  const currentHour = now.getUTCHours()

  // Only run on scheduled day and hour
  if (currentDate !== MONTHLY_MAINTENANCE_DAY || currentHour !== DAILY_MAINTENANCE_HOUR) {
    return false
  }

  // Check if we already ran this month
  if (state.lastMonthlyRun) {
    const monthAgo = new Date(now.getTime() - 28 * 24 * HOUR)
    if (state.lastMonthlyRun > monthAgo) {
      return false
    }
  }

  return true
}

/**
 * Run scheduled maintenance tasks
 */
async function runScheduledMaintenance() {
  if (state.isRunning) {
    logger.debug('[Scheduler] Maintenance already running, skipping...')
    return
  }

  state.isRunning = true

  try {
    // Monthly includes weekly and daily
    if (shouldRunMonthly()) {
      logger.info('[Scheduler] Starting monthly maintenance...')
      const report = await DatabaseMaintenanceService.runMonthlyMaintenance()
      state.lastMonthlyRun = new Date()
      state.lastWeeklyRun = new Date()
      state.lastDailyRun = new Date()
      logger.info(
        `[Scheduler] Monthly maintenance complete. Deleted: ${report.totalDeleted}, Updated: ${report.totalUpdated}, Errors: ${report.errors.length}`
      )
      if (report.errors.length > 0) {
        logger.error(`[Scheduler] Maintenance errors: ${report.errors.join(', ')}`)
      }
      return
    }

    // Weekly includes daily
    if (shouldRunWeekly()) {
      logger.info('[Scheduler] Starting weekly maintenance...')
      const report = await DatabaseMaintenanceService.runWeeklyMaintenance()
      state.lastWeeklyRun = new Date()
      state.lastDailyRun = new Date()
      logger.info(
        `[Scheduler] Weekly maintenance complete. Deleted: ${report.totalDeleted}, Updated: ${report.totalUpdated}, Errors: ${report.errors.length}`
      )
      if (report.errors.length > 0) {
        logger.error(`[Scheduler] Maintenance errors: ${report.errors.join(', ')}`)
      }
      return
    }

    // Daily maintenance
    if (shouldRunDaily()) {
      logger.info('[Scheduler] Starting daily maintenance...')
      const report = await DatabaseMaintenanceService.runDailyMaintenance()
      state.lastDailyRun = new Date()
      logger.info(
        `[Scheduler] Daily maintenance complete. Deleted: ${report.totalDeleted}, Updated: ${report.totalUpdated}, Errors: ${report.errors.length}`
      )
      if (report.errors.length > 0) {
        logger.error(`[Scheduler] Maintenance errors: ${report.errors.join(', ')}`)
      }
    }
  } catch (error) {
    logger.error(`[Scheduler] Maintenance failed: ${error}`)
  } finally {
    state.isRunning = false
  }
}

/**
 * Initialize the scheduler
 */
function initScheduler() {
  if (!SCHEDULER_ENABLED) {
    logger.info('[Scheduler] Database maintenance scheduler is DISABLED')
    logger.info('[Scheduler] Set SCHEDULER_ENABLED=true in .env to enable')
    logger.info('[Scheduler] Or use external cron: node ace db:maintenance --schedule=daily')
    return
  }

  logger.info('[Scheduler] Database maintenance scheduler is ENABLED')
  logger.info(`[Scheduler] Daily maintenance scheduled at ${DAILY_MAINTENANCE_HOUR}:00 UTC`)
  logger.info(
    `[Scheduler] Weekly maintenance scheduled on Sunday at ${DAILY_MAINTENANCE_HOUR}:00 UTC`
  )
  logger.info(
    `[Scheduler] Monthly maintenance scheduled on 1st at ${DAILY_MAINTENANCE_HOUR}:00 UTC`
  )

  // Check every 30 minutes
  setInterval(runScheduledMaintenance, 30 * MINUTE)

  // Run initial check after 1 minute (to let the app fully start)
  setTimeout(runScheduledMaintenance, MINUTE)
}

// Initialize when this file is loaded
initScheduler()

export { runScheduledMaintenance, state as schedulerState }
