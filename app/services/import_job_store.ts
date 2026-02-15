import { randomUUID } from 'node:crypto'
import type { FetchResult } from '#services/mal_import_service'
import logger from '@adonisjs/core/services/logger'

export interface ImportJobProgress {
  stage: 'pending' | 'scraping' | 'matching' | 'resolving' | 'completed' | 'failed'
  totalCandidates: number
  matchedInPass1: number
  totalToResolve: number
  resolvedCount: number
  currentTitle: string | null
}

export interface ImportJob {
  id: string
  userId: string
  progress: ImportJobProgress
  result: FetchResult | null
  error: string | null
  createdAt: number
  updatedAt: number
}

const CLEANUP_DELAY_MS = 30 * 60 * 1000 // 30 minutes
const STALE_JOB_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes without progress update
const STALE_CHECK_INTERVAL_MS = 2 * 60 * 1000 // Check every 2 minutes

const TERMINAL_STAGES = new Set(['completed', 'failed'])

class ImportJobStore {
  private jobs = new Map<string, ImportJob>()
  private userJobMap = new Map<string, string>() // userId → jobId
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.startStaleJobChecker()
  }

  createJob(userId: string): string {
    // Cancel any existing job for this user
    const existingJobId = this.userJobMap.get(userId)
    if (existingJobId) {
      this.removeJob(existingJobId)
    }

    const now = Date.now()
    const id = randomUUID()
    const job: ImportJob = {
      id,
      userId,
      progress: {
        stage: 'pending',
        totalCandidates: 0,
        matchedInPass1: 0,
        totalToResolve: 0,
        resolvedCount: 0,
        currentTitle: null,
      },
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }

    this.jobs.set(id, job)
    this.userJobMap.set(userId, id)
    this.scheduleCleanup(id)

    return id
  }

  getJob(jobId: string): ImportJob | null {
    return this.jobs.get(jobId) ?? null
  }

  getJobByUserId(userId: string): ImportJob | null {
    const jobId = this.userJobMap.get(userId)
    if (!jobId) return null
    return this.jobs.get(jobId) ?? null
  }

  updateProgress(jobId: string, partial: Partial<ImportJobProgress>): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    Object.assign(job.progress, partial)
    job.updatedAt = Date.now()
  }

  completeJob(jobId: string, result: FetchResult): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.progress.stage = 'completed'
    job.result = result
    job.updatedAt = Date.now()
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.progress.stage = 'failed'
    job.error = error
    job.updatedAt = Date.now()
  }

  dismissJob(jobId: string): void {
    this.removeJob(jobId)
  }

  dismissJobByUserId(userId: string): void {
    const jobId = this.userJobMap.get(userId)
    if (jobId) {
      this.removeJob(jobId)
    }
  }

  private removeJob(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (job) {
      this.userJobMap.delete(job.userId)
    }
    this.jobs.delete(jobId)
    const timer = this.cleanupTimers.get(jobId)
    if (timer) {
      clearTimeout(timer)
      this.cleanupTimers.delete(jobId)
    }
  }

  private scheduleCleanup(jobId: string): void {
    const timer = setTimeout(() => {
      this.removeJob(jobId)
    }, CLEANUP_DELAY_MS)
    this.cleanupTimers.set(jobId, timer)
  }

  /**
   * Periodically check for stale jobs stuck in a non-terminal stage
   * (pending, scraping, matching, resolving) without any progress update
   * for longer than STALE_JOB_THRESHOLD_MS. These jobs are marked as
   * failed and removed.
   */
  private startStaleJobChecker(): void {
    this.staleCheckTimer = setInterval(() => {
      const now = Date.now()

      for (const [jobId, job] of this.jobs) {
        if (TERMINAL_STAGES.has(job.progress.stage)) continue

        const elapsed = now - job.updatedAt
        if (elapsed >= STALE_JOB_THRESHOLD_MS) {
          logger.warn(
            `[ImportJobStore] Removing stale job ${jobId} (user=${job.userId}, stage=${job.progress.stage}, idle for ${Math.round(elapsed / 1000)}s)`
          )
          job.progress.stage = 'failed'
          job.error = 'Import timed out — please try again.'
          job.updatedAt = now
          // Keep the failed job briefly so the client can see the error,
          // the existing 30-min cleanup timer will remove it.
        }
      }
    }, STALE_CHECK_INTERVAL_MS)

    // Allow the process to exit even if the interval is still running
    if (this.staleCheckTimer.unref) {
      this.staleCheckTimer.unref()
    }
  }
}

const importJobStore = new ImportJobStore()
export default importJobStore
