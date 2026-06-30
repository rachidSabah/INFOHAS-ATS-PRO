// ============================================================================
// BackgroundJobManager — Cloudflare Queues Integration
// ============================================================================
// Wraps Cloudflare Queues for background processing of optimization,
// export, and maintenance jobs.
//
// Phase 7 constraint: even when running in a queue consumer, export must
// still run validateExportCompleteness() synchronously before producing
// any file — queue/cache paths don't skip the gate.
// ============================================================================

import type { Queue } from '../cache/cloudflare-types';

// ============================================================================
// Types
// ============================================================================

export type JobType =
  | 'optimize'
  | 'export'
  | 'reindex'
  | 'maintenance'
  | 'refresh-blueprint'
  | 'health-check'
  | 'bulk-export';

export interface Job<T = unknown> {
  id: string;
  type: JobType;
  payload: T;
  priority: 'high' | 'normal' | 'low';
  createdAt: string;
  retryCount: number;
  maxRetries: number;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<JobResult>;

// ============================================================================
// BackgroundJobManager
// ============================================================================

export class BackgroundJobManager {
  private queue: Queue;
  private handlers = new Map<JobType, JobHandler>();
  private results: JobResult[] = [];
  private maxResultLog = 200;

  constructor(queue: Queue) {
    this.queue = queue;
  }

  // ── Registration ────────────────────────────────────────────────────

  /**
   * Register a handler for a specific job type.
   */
  registerHandler<T>(type: JobType, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  /**
   * Get the handler for a job type.
   */
  getHandler(type: JobType): JobHandler | undefined {
    return this.handlers.get(type);
  }

  // ── Production ──────────────────────────────────────────────────────

  /**
   * Enqueue a job to be processed asynchronously.
   * This is the primary API for background work.
   */
  async enqueue<T>(type: JobType, payload: T, options?: {
    priority?: 'high' | 'normal' | 'low';
    delaySeconds?: number;
  }): Promise<string> {
    const job: Job<T> = {
      id: this.generateId(type),
      type,
      payload,
      priority: options?.priority ?? 'normal',
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: 3,
    };

    await this.queue.send(job, {
      contentType: 'json',
      delaySeconds: options?.delaySeconds,
    });

    return job.id;
  }

  /**
   * Enqueue multiple jobs in a batch.
   */
  async enqueueBatch<T>(type: JobType, payloads: T[], options?: {
    priority?: 'high' | 'normal' | 'low';
  }): Promise<string[]> {
    const jobs = payloads.map((payload) => ({
      body: {
        id: this.generateId(type),
        type,
        payload,
        priority: options?.priority ?? 'normal',
        createdAt: new Date().toISOString(),
        retryCount: 0,
        maxRetries: 3,
      } as Job,
      contentType: 'json' as const,
    }));

    await this.queue.sendBatch(jobs);
    return jobs.map((j) => j.body.id);
  }

  // ── Consumption ─────────────────────────────────────────────────────

  /**
   * Process a single job message (called by the queue consumer).
   * Returns the result of the handler.
   */
  async process(job: Job): Promise<JobResult> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      const result: JobResult = {
        jobId: job.id,
        success: false,
        error: `No handler registered for job type "${job.type}"`,
        durationMs: 0,
      };
      this.logResult(result);
      return result;
    }

    const start = Date.now();
    try {
      const result = await handler(job);
      result.durationMs = Date.now() - start;
      this.logResult(result);
      return result;
    } catch (err) {
      const result: JobResult = {
        jobId: job.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
      this.logResult(result);
      return result;
    }
  }

  /**
   * Process a batch of jobs (called by the queue consumer on batch delivery).
   */
  async processBatch(jobs: Job[]): Promise<JobResult[]> {
    return Promise.all(jobs.map((job) => this.process(job)));
  }

  // ── Query ───────────────────────────────────────────────────────────

  /**
   * Get recent job results (for monitoring).
   */
  getRecentResults(limit = 20): JobResult[] {
    return this.results.slice(-limit).reverse();
  }

  /**
   * Get success/failure stats.
   */
  getStats(): { total: number; success: number; failure: number } {
    const total = this.results.length;
    const success = this.results.filter((r) => r.success).length;
    return { total, success, failure: total - success };
  }

  // ── Private ─────────────────────────────────────────────────────────

  private generateId(type: JobType): string {
    const prefix = type.slice(0, 3).toUpperCase();
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `${prefix}_${ts}_${rand}`;
  }

  private logResult(result: JobResult): void {
    this.results.push(result);
    if (this.results.length > this.maxResultLog) {
      this.results = this.results.slice(-this.maxResultLog);
    }
  }
}

// ============================================================================
// Typed Job Helpers
// ============================================================================

/** Create an optimization job payload */
export interface OptimizeJobPayload {
  resumeId: string;
  directiveId: string;
  userId?: string;
}

/** Create an export job payload */
export interface ExportJobPayload {
  resumeId: string;
  format: string;
  sourceVersion: string;
  userId?: string;
}

/** Create a maintenance job payload */
export interface MaintenanceJobPayload {
  task: 'refresh-stale-caches' | 'clean-old-exports' | 'verify-data-integrity';
  olderThanDays?: number;
}
