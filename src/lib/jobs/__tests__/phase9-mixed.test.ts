// ============================================================================
// Phase 9 — Request Dedup, CPU Time, Tracing Tests
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { RequestDeduplicator } from '../../cache/request-dedup';
import { CpuTimeTracker, processInBatches, parallelMap } from '../cpu-time-optimization';
import { LightweightTracer } from '../../tracing/lightweight-tracer';

// ============================================================================
// RequestDeduplicator Tests
// ============================================================================

describe('RequestDeduplicator', () => {
  it('executes a request normally', async () => {
    const deduper = new RequestDeduplicator({ windowMs: 1000 });
    const fn = vi.fn().mockResolvedValue('result');
    const result = await deduper.execute('sig-1', fn);
    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates in-flight identical requests', async () => {
    const deduper = new RequestDeduplicator({ windowMs: 1000 });
    const delayed = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r('done'), 50)));

    const [r1, r2] = await Promise.all([
      deduper.execute('sig-2', delayed),
      deduper.execute('sig-2', delayed),
    ]);
    expect(r1).toBe('done');
    expect(r2).toBe('done');
    expect(delayed).toHaveBeenCalledTimes(1);
  });

  it('returns cached result within window', async () => {
    const deduper = new RequestDeduplicator({ windowMs: 5000 });
    const fn = vi.fn().mockResolvedValue('cached');

    await deduper.execute('sig-3', fn);
    const result2 = await deduper.execute('sig-3', fn);
    expect(result2).toBe('cached');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-executes after window expires', async () => {
    const deduper = new RequestDeduplicator({ windowMs: 100 });
    const fn = vi.fn().mockResolvedValue('fresh');

    await deduper.execute('sig-4', fn);
    await new Promise((r) => setTimeout(r, 150));
    await deduper.execute('sig-4', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('creates consistent signatures', () => {
    const sig1 = RequestDeduplicator.createSignature('GET', '/api/resume/abc');
    const sig2 = RequestDeduplicator.createSignature('GET', '/api/resume/abc');
    expect(sig1).toBe(sig2);

    const sig3 = RequestDeduplicator.createSignature('POST', '/api/optimize', { id: 'abc' });
    const sig4 = RequestDeduplicator.createSignature('POST', '/api/optimize', { id: 'abc' });
    expect(sig3).toBe(sig4);

    const sig5 = RequestDeduplicator.createSignature('POST', '/api/optimize', { id: 'def' });
    expect(sig3).not.toBe(sig5);
  });

  it('tracks stats correctly', async () => {
    const deduper = new RequestDeduplicator({ windowMs: 5000 });
    const fn = vi.fn().mockResolvedValue('stats');
    await deduper.execute('stats-sig', fn);
    await deduper.execute('stats-sig', fn); // window hit
    const stats = deduper.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.windowHits).toBe(1);
  });
});

// ============================================================================
// CpuTimeTracker Tests
// ============================================================================

describe('CpuTimeTracker', () => {
  it('tracks phase durations', () => {
    const tracker = new CpuTimeTracker('req-1', { totalBudgetMs: 1000 });
    tracker.startPhase('test-phase');
    // Simulate some CPU work
    const start = performance.now();
    while (performance.now() - start < 5) {
      // busy wait (very short)
    }
    tracker.stopCurrentPhase();
    const report = tracker.report();
    expect(report.phases.length).toBeGreaterThanOrEqual(1);
    expect(report.phases[0].name).toBe('test-phase');
    expect(report.phases[0].durationMs).toBeGreaterThan(0);
  });

  it('generates warnings when approaching budget', () => {
    const tracker = new CpuTimeTracker('req-2', { totalBudgetMs: 100, warningThreshold: 50 });
    tracker.addOverhead(60);
    const warnings = tracker.getWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('60');
  });

  it('detects budget exceeded', () => {
    const tracker = new CpuTimeTracker('req-3', { totalBudgetMs: 100 });
    tracker.addOverhead(150);
    expect(tracker.isOverBudget).toBe(true);
  });

  it('reports correctly', () => {
    const tracker = new CpuTimeTracker('req-4', { totalBudgetMs: 1000 });
    tracker.addOverhead(150);
    const report = tracker.report();
    expect(report.requestId).toBe('req-4');
    expect(report.totalCpuMs).toBe(150);
    expect(report.budgetUsedPercent).toBe(15);
  });
});

// ============================================================================
// processInBatches Tests
// ============================================================================

describe('processInBatches', () => {
  it('processes items in batches', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = vi.fn().mockImplementation(async (batch: number[]) => batch.map((n) => n * 2));
    const results = await processInBatches(items, 2, processor);
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(processor).toHaveBeenCalledTimes(3); // batches of 2, 2, 1
  });
});

describe('parallelMap', () => {
  it('processes items with concurrency', async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = vi.fn().mockImplementation(async (n: number) => n * 2);
    const results = await parallelMap(items, fn, 3);
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(fn).toHaveBeenCalledTimes(5);
  });
});

// ============================================================================
// LightweightTracer Tests
// ============================================================================

describe('LightweightTracer', () => {
  it('creates and completes spans', () => {
    const tracer = new LightweightTracer({ serviceName: 'test', maxSpansPerFlush: 100, enableLogpush: false });
    const spanId = tracer.startSpan('test-op');
    expect(spanId).toBeDefined();
    tracer.endSpan(spanId, 'ok');
    const trace = tracer.toTrace();
    expect(trace).toHaveLength(1);
    expect(trace[0].name).toBe('test-op');
    expect(trace[0].status).toBe('ok');
    expect(trace[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sets parent-child span relationships', () => {
    const tracer = new LightweightTracer({ serviceName: 'test', maxSpansPerFlush: 100, enableLogpush: false });
    const parentId = tracer.startSpan('parent');
    const childId = tracer.startSpan('child');
    tracer.endSpan(childId);
    tracer.endSpan(parentId);
    const trace = tracer.toTrace();
    const childSpan = trace.find((s) => s.spanId === childId);
    expect(childSpan?.parentSpanId).toBe(parentId);
  });

  it('adds events to spans', () => {
    const tracer = new LightweightTracer({ serviceName: 'test', maxSpansPerFlush: 100, enableLogpush: false });
    const spanId = tracer.startSpan('eventful');
    tracer.addEvent(spanId, 'cache-miss', { key: 'test-key' });
    tracer.endSpan(spanId);
    const trace = tracer.toTrace();
    expect(trace[0].events).toHaveLength(1);
    expect(trace[0].events[0].name).toBe('cache-miss');
  });

  it('sets attributes on spans', () => {
    const tracer = new LightweightTracer({ serviceName: 'test', maxSpansPerFlush: 100, enableLogpush: false });
    const spanId = tracer.startSpan('attributed');
    tracer.setAttribute(spanId, 'resumeId', 'abc-123');
    tracer.endSpan(spanId);
    const trace = tracer.toTrace();
    expect(trace[0].attributes.resumeId).toBe('abc-123');
  });

  it('finalizes and flushes spans', async () => {
    const tracer = new LightweightTracer({ serviceName: 'test', maxSpansPerFlush: 100, enableLogpush: false });
    tracer.startSpan('final-span');
    // finalize ends all active spans
    const result = await tracer.finalize();
    expect(result.spanCount).toBe(0); // all flushed
    expect(result.traceId).toBeDefined();
  });

  it('auto-flushes when max spans reached', () => {
    const tracer = new LightweightTracer({ serviceName: 'test', maxSpansPerFlush: 3, enableLogpush: false });
    for (let i = 0; i < 5; i++) {
      const id = tracer.startSpan(`span-${i}`);
      tracer.endSpan(id);
    }
    const trace = tracer.toTrace();
    expect(trace.length).toBeLessThan(5); // some were flushed
  });
});
