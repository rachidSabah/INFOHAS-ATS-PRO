// ============================================================================
// Phase 9 — BackgroundJobManager Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackgroundJobManager } from '../index';
import type { Job } from '../index';

// ── Mock Queue ─────────────────────────────────────────────────────────

function createMockQueue(): any {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('BackgroundJobManager', () => {
  let queue: any;
  let manager: BackgroundJobManager;

  beforeEach(() => {
    queue = createMockQueue();
    manager = new BackgroundJobManager(queue);
  });

  it('enqueues a job to the queue', async () => {
    const jobId = await manager.enqueue('optimize', { resumeId: 'abc', directiveId: 'def' });
    expect(jobId).toBeDefined();
    expect(queue.send).toHaveBeenCalledTimes(1);
    const sentJob = queue.send.mock.calls[0][0];
    expect(sentJob.type).toBe('optimize');
    expect(sentJob.payload.resumeId).toBe('abc');
  });

  it('enqueues a batch of jobs', async () => {
    const ids = await manager.enqueueBatch('export', [
      { resumeId: 'a', format: 'docx', sourceVersion: '1' },
      { resumeId: 'b', format: 'pdf', sourceVersion: '1' },
    ]);
    expect(ids).toHaveLength(2);
    expect(queue.sendBatch).toHaveBeenCalledTimes(1);
    const batch = queue.sendBatch.mock.calls[0][0];
    expect(batch).toHaveLength(2);
  });

  it('processes a job using registered handler', async () => {
    const handler = vi.fn().mockResolvedValue({
      jobId: 'test-1', success: true, durationMs: 10,
    });
    manager.registerHandler('optimize', handler);

    const job: Job = {
      id: 'test-1', type: 'optimize',
      payload: { resumeId: 'abc' },
      priority: 'normal',
      createdAt: new Date().toISOString(),
      retryCount: 0, maxRetries: 3,
    };

    const result = await manager.process(job);
    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalledWith(job);
  });

  it('returns error for unregistered job type', async () => {
    const job: Job = {
      id: 'test-2', type: 'maintenance',
      payload: { task: 'clean-old-exports' },
      priority: 'low',
      createdAt: new Date().toISOString(),
      retryCount: 0, maxRetries: 3,
    };

    const result = await manager.process(job);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No handler registered');
  });

  it('tracks recent results', async () => {
    const handler = vi.fn().mockResolvedValue({
      jobId: 'track-1', success: true,
    });
    manager.registerHandler('health-check', handler);

    const job: Job = {
      id: 'track-1', type: 'health-check',
      payload: {},
      priority: 'normal',
      createdAt: new Date().toISOString(),
      retryCount: 0, maxRetries: 3,
    };

    await manager.process(job);
    const results = manager.getRecentResults();
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it('processes a batch of jobs', async () => {
    const handler = vi.fn().mockResolvedValue({
      jobId: 'batch-1', success: true, durationMs: 5,
    });
    manager.registerHandler('optimize', handler);

    const jobs: Job[] = [
      { id: 'batch-1', type: 'optimize', payload: { resumeId: 'a' }, priority: 'normal', createdAt: '', retryCount: 0, maxRetries: 3 },
      { id: 'batch-2', type: 'optimize', payload: { resumeId: 'b' }, priority: 'normal', createdAt: '', retryCount: 0, maxRetries: 3 },
    ];

    const results = await manager.processBatch(jobs);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('reports stats correctly', () => {
    expect(manager.getStats()).toEqual({ total: 0, success: 0, failure: 0 });
  });
});
