import { randomUUID } from 'node:crypto'
import type { FetchResult } from '#services/mal_import_service'

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
}

const CLEANUP_DELAY_MS = 30 * 60 * 1000 // 30 minutes

class ImportJobStore {
  private jobs = new Map<string, ImportJob>()
  private userJobMap = new Map<string, string>() // userId → jobId
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

  createJob(userId: string): string {
    // Cancel any existing job for this user
    const existingJobId = this.userJobMap.get(userId)
    if (existingJobId) {
      this.removeJob(existingJobId)
    }

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
      createdAt: Date.now(),
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
  }

  completeJob(jobId: string, result: FetchResult): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.progress.stage = 'completed'
    job.result = result
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.progress.stage = 'failed'
    job.error = error
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
}

const importJobStore = new ImportJobStore()
export default importJobStore
