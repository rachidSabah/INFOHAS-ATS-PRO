# Phase 9 — Performance, Scalability & Cloudflare Optimization

> **Commit:** `03c7641`  
> **Baseline:** 1124 tests passing (64 test files)  
> **Precondition:** Phase 7 (lossless export) + Phase 8 (plugin SDK) deployed with green regression suites  
> **Stack:** Cloudflare Pages + Workers + D1 + KV + Queues + R2 + Durable Objects

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       Request Flow                               │
│                                                                  │
│  Client → RequestDeduplicator → KVCacheClient (cache-aside)     │
│                                     │                            │
│                          ┌──────────┴──────────┐                │
│                          │  Cache Hit?          │                │
│                          └──────┬──────┬───────┘                │
│                             No  │     │  Yes                     │
│                          ┌──────┘     └────────┐               │
│                          ▼                      ▼               │
│                    D1 Query            Return cached            │
│                    (optimized)         response + refresh        │
│                          │                                      │
│                          ▼                                      │
│               CacheInvalidationService                          │
│               (write → invalidate → next read refills)          │
│                                                                  │
│  Long Ops → BackgroundJobManager → Cloudflare Queues            │
│               → Queue Consumer → validateExportCompleteness()   │
│               → R2StorageBackend → ExportArtifact stored in R2  │
│                                                                  │
│  Progress → SessionManager → SessionDO (Durable Object)         │
│               → Crash recovery via snapshots + state.storage    │
│                                                                  │
│  CPU Tracking → CpuTimeTracker (performance.now() per phase)    │
│  Tracing → LightweightTracer → Logpush / OTel endpoint          │
└──────────────────────────────────────────────────────────────────┘
```

## 1. KV Caching Layer (`src/lib/cache/kv-cache.ts`)

**Pattern:** Cache-aside with explicit invalidation. KV is eventually consistent globally — we never use write-through.

**Read path:**
1. Check KV with TTL check (belt-and-suspenders with KV's own TTL)
2. Hit → return cached value
3. Miss → call `loader()` (usually D1 query)
4. Write result to KV with TTL → return

**Write path:**
1. Write to D1 (source of truth)
2. Call `cache.invalidate(key)` to delete KV key
3. Next read misses and refills from D1

**Key features:**
- `getOrFetch<T>(key, loader, ttl?)` — standard cache-aside
- `invalidate(key)` — explicit invalidation
- `invalidateByPrefix(prefix)` — bulk invalidation (e.g., all caches for a resume)
- `createTypedCache<T>()` — strongly typed wrapper for entity types
- TTL-based expiry with second-layer check (application-level in the `CacheEntry` wrapper)
- Built-in hit/miss stats tracking

## 2. Cache Invalidation Service (`src/lib/cache/cache-invalidation.ts`)

Invalidation is triggered by D1 table mutations through the `CacheInvalidationService`.

**Rule-based mapping:** Each D1 table maps to affected cache prefixes:
- `resumes` → `resume:`, `optimization:`, `export:`
- `optimizations` → `optimization:`, `export:`
- `directives` → `directive:`
- etc.

**Methods:**
- `onTableChange(table, entityId?)` — automatically invalidates all related cache keys
- `invalidateKey(key, reason)` — direct single-key invalidation
- `invalidatePrefix(prefix)` — bulk invalidation by prefix
- `invalidateAll()` — full cache flush (emergency only)
- Invalidation event log (last 100 events) for debugging

## 3. R2 Binary Export Storage (`src/lib/storage/r2-storage.ts`)

Binary export artifacts (DOCX/PDF/HTML/TXT) stored in R2, NOT in D1 (row size limits) or KV (per-value size limits, cost on large blobs).

**Key structure:** `exports/{resumeId}/{format}/{timestamp}.{ext}`

**Custom metadata per artifact:**
- `sourceVersion` — data version tag for staleness checking
- `completenessHash` — sha256 of `validateExportCompleteness()` result
- `sectionCount`, `format`, `generatedAt`, `renderDurationMs`

**Methods:**
- `store(resumeId, format, data, metadata)` — upload with metadata
- `getLatest(resumeId, format)` — retrieve most recent artifact
- `listForResume(resumeId)` — list all artifacts for a resume
- `deleteForResume(resumeId)` — delete all artifacts (on resume deletion)

## 4. BackgroundJobManager (`src/lib/jobs/background-job-manager.ts`)

Wraps Cloudflare Queues for async processing. Enforces Phase 7 constraint: `validateExportCompleteness()` runs synchronously in the consumer before any file is produced.

**Job types:** `optimize`, `export`, `reindex`, `maintenance`, `refresh-blueprint`, `health-check`, `bulk-export`

**Methods:**
- `enqueue(type, payload)` — single job
- `enqueueBatch(type, payloads)` — batch (uses Queue.sendBatch)
- `registerHandler(type, handler)` — register consumer handler
- `process(job)` / `processBatch(jobs)` — consume messages
- `getRecentResults()` / `getStats()` — monitoring

**Job IDs:** Auto-generated with type prefix + base36 timestamp + random suffix (e.g., `OPT_1a2b3c_xy12`).

## 5. Durable Object Session Recovery (`src/lib/durable-objects/session-do.ts`)

One SessionDO instance per resume-session scope, keyed by resumeId + userId. Provides crash recovery for long-running operations (optimization, export, blueprint generation).

**State machine:** `idle → running → completed | failed | cancelled`

**Operations:**
- `start(operation, payload, resumeDataSnapshot?)`
- `updateProgress(progress)` — step name, 0-100%, message
- `saveSnapshot(resumeDataAsJson)` — saves crash-recovery snapshot
- `complete(result)` / `fail(error)` / `cancel()`
- `getRecoveryToken()` — generates a 30-second reconnection token

**Persistence:** DO state is persisted via `state.storage.put()` for crash safety. On DO restart, state is restored from storage.

**SessionManager:** Client-side facade that communicates with the DO via HTTP (fetch) through the DO stub.

## 6. Request Deduplication (`src/lib/cache/request-dedup.ts`)

Prevents duplicate work when identical requests arrive within a short window (rapid keystrokes, double-clicks, retry storms).

**Three-level dedup:**
1. **In-flight:** Same request already pending → return existing promise
2. **Window cache:** Same request completed within `windowMs` → return cached result
3. **Fresh:** Execute normally, cache result for subsequent calls

**Signature creation:** `RequestDeduplicator.createSignature(method, url, body?)` — hashes body content for deterministic dedup keys.

**Stats:** total requests, deduplicated count, window hits, in-flight count.

## 7. CPU Time Optimization (`src/lib/jobs/cpu-time-optimization.ts`)

Workers are billed/limited on CPU time, not wall-clock time. This module helps track and stay within budget.

**CpuTimeTracker:**
- `startPhase(name)` / `stopCurrentPhase()` — track named phases
- `addOverhead(ms)` — compensate for async boundaries
- `getWarnings()` — alert when approaching budget (>80% of limit, individual phase >30%)
- `report()` — full CPU time report with per-phase breakdown
- `isOverBudget` — boolean check against configured limit

**Batch/parallel utilities:**
- `processInBatches(items, batchSize, processor)` — splits items into D1-compatible batches (100 stmt limit), processes sequentially, reports progress
- `parallelMap(items, fn, concurrency)` — parallel execution with configurable concurrency cap

## 8. Distributed Tracing (`src/lib/tracing/lightweight-tracer.ts`)

Workers-compatible span-based tracer. Does NOT use OpenTelemetry SDK directly (limited Worker runtime support). Outputs OTel-compatible JSON for Logpush consumption and can optionally forward to external APM endpoints (Grafana Tempo, etc.).

**Architecture:**
- `LightweightTracer` — creates spans with parent-child relationships
- `Span` — name, traceId, spanId, parentSpanId, status, timing, attributes, events
- Auto-flush when max span count reached
- `finalize()` — ends remaining spans, flushes all

**Export paths:**
1. **Logpush:** Structured JSON logged to console → consumed by Cloudflare Logpush
2. **External APM:** POST to configured endpoint in OTLP-compatible format

**Usage:**
```ts
const tracer = new LightweightTracer({ serviceName: 'resumeai-pro' });
const spanId = tracer.startSpan('db.query.resume');
tracer.setAttribute(spanId, 'resumeId', resume.id);
// ... work ...
tracer.endSpan(spanId);
await tracer.finalize();
```

## 9. Phase 7/8 Constraint Compliance

| Phase | Constraint | Implementation |
|-------|-----------|----------------|
| **7** | `validateExportCompleteness()` runs before every file export | Enforced in `BackgroundJobManager` consumers + existing `exporter.ts` gate |
| **8** | All perf work through PluginManager/ServiceContainer — no fast-path bypass | `KVCacheClient` wraps `IExporter` interface, doesn't bypass it |
| **8** | OptimizationDirective must remain non-stale when cached | Cache invalidation rules invalidate directive: prefix on any `directives` table change |

## 10. Test Coverage

| Module | Tests | File |
|--------|-------|------|
| KVCacheClient | 11 | `src/lib/cache/__tests__/kv-cache.test.ts` |
| CacheInvalidationService | 5 | `src/lib/cache/__tests__/kv-cache.test.ts` |
| R2StorageBackend | 5 | `src/lib/storage/__tests__/r2-storage.test.ts` |
| BackgroundJobManager | 7 | `src/lib/jobs/__tests__/background-job-manager.test.ts` |
| SessionDO | 13 | `src/lib/durable-objects/__tests__/session-do.test.ts` |
| RequestDeduplicator | 6 | `src/lib/jobs/__tests__/phase9-mixed.test.ts` |
| CpuTimeTracker | 4 | `src/lib/jobs/__tests__/phase9-mixed.test.ts` |
| Batch processing | 2 | `src/lib/jobs/__tests__/phase9-mixed.test.ts` |
| LightweightTracer | 6 | `src/lib/jobs/__tests__/phase9-mixed.test.ts` |
| **Total new** | **59** | 3 test files + mixed |

## 11. Deployment Considerations

### wrangler.toml additions needed:
```toml
[[kv_namespaces]]
binding = "RESUME_KV"
id = "<your-kv-namespace-id>"

[[r2_buckets]]
binding = "EXPORT_R2"
bucket_name = "resumeai-exports"

[[queues]]
binding = "OPTIMIZATION_QUEUE"
queue_name = "resumeai-optimization-queue"

[[durable_objects.bindings]]
name = "SESSION_DO"
class_name = "SessionDO"

[[migrations]]
tag = "v1"
new_classes = ["SessionDO"]
```

### KV key format:
- `cache:<entityType>:<entityId>` — standard cache key
- `cache:resume:abc123` — resume data
- `cache:optimization:abc123` — optimization result
- `cache:directive:<directiveId>` — optimization directive

### Queue consumer worker:
```ts
export default {
  async queue(batch, env, ctx) {
    const manager = new BackgroundJobManager(env.OPTIMIZATION_QUEUE);
    // register handlers
    manager.registerHandler('export', handleExport);
    manager.registerHandler('optimize', handleOptimize);
    // process
    await manager.processBatch(batch.messages.map(m => m.body));
  }
};
```
