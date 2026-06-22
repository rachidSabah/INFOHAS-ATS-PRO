# Recommendations for Future Improvements — Next Sprint

**Project:** ResumeAI Pro
**Scope:** Short-term execution (next sprint, ~2 weeks)
**Author:** Senior Build Engineer
**Date:** 2026-06-23
**Status:** Proposed

---

## Executive Summary

This document outlines four short-term engineering initiatives ordered by priority. Each item includes concrete implementation steps, risk analysis, effort estimate, and a recommended execution order. The priorities are sequenced to deliver quick wins first (D1 migration, CI/CD) before larger architectural changes (WebSocket pipeline, multi-region reads), so the team sees compounding value throughout the sprint rather than only at the end.

**Priority order (recommended):**
1. **P1** — Database Migration Optimization (Effort: S)
2. **P2** — CI/CD Pipeline Implementation (Effort: M)
3. **P3** — Real-time Pipeline Updates via WebSocket (Effort: L)
4. **P4** — Multi-region Read Scaling (Effort: M, partially blocked)

Total estimated effort: ~3.5–4.5 engineering weeks. The sprint can absorb items P1 + P2 + P3 comfortably; P4 is a stretch goal that depends on Cloudflare's D1 roadmap.

---

## P1 — Database Migration Optimization

**Goal:** Eliminate per-request schema-introspection overhead on the branding endpoint by applying migration 0006 and removing the `columnExists()` guard.

### Why this is P1
The worker currently runs `PRAGMA table_info(branding)` on every `PUT /api/settings/branding` request to decide whether the `provider_settings_json` column exists. This adds ~10–30ms of latency per write, pollutes the D1 query cache, and obscures real schema errors in production logs. Applying the migration is a one-time, low-risk operation that immediately removes this overhead.

### Implementation steps

1. **Pre-flight verification (local)**
   - Confirm `/home/z/my-project/migrations/0006_provider_settings.sql` contains the expected `ALTER TABLE` statements:
     ```sql
     ALTER TABLE branding ADD COLUMN provider_settings_json TEXT;
     ALTER TABLE branding ADD COLUMN ai_routing_settings_json TEXT;
     ```
   - Run the migration against the local D1 clone to validate syntax:
     ```bash
     npx wrangler d1 migrations apply resumeai-pro-db --local
     ```

2. **Apply to remote (production)**
   - Run the migration against the production D1:
     ```bash
     npx wrangler d1 migrations apply resumeai-pro-db --remote
     ```
   - Expected runtime: < 5 seconds. The `ALTER TABLE … ADD COLUMN` is metadata-only on SQLite — no rows are rewritten.

3. **Post-migration verification**
   - Confirm the columns exist on production:
     ```bash
     npx wrangler d1 execute resumeai-pro-db --remote \
       --command "PRAGMA table_info(branding)"
     ```
   - Hit `PUT /api/settings/branding` with a test payload and confirm the response includes `migrationApplied: true`.

4. **Remove the `columnExists()` guard from the worker**
   - In `workers/api/index.ts`, simplify `PUT /api/settings/branding`:
     - Delete the `columnExists()` lookup.
     - Always include `provider_settings_json = ?` and `ai_routing_settings_json = ?` in the UPDATE statement.
     - Remove the `migrationApplied` flag from the response (no longer meaningful).
   - Keep the `columnExists()` helper function in the codebase — it's still useful for future migrations and for the `onError` handler's schema-error detection.

5. **Deploy the worker**
   - `npx wrangler deploy`
   - Monitor `/api/health` for 5 minutes; confirm `db: "connected"` and no 500s on branding PUT.

6. **Rollback plan (if needed)**
   - If the deploy introduces regressions, roll back the worker to the previous version:
     ```bash
     npx wrangler rollback
     ```
   - The migration itself is forward-compatible (added columns are nullable) — no rollback needed at the DB layer.

### Risks / dependencies
- **Low risk.** `ALTER TABLE ADD COLUMN` with a nullable default is non-locking on D1/SQLite.
- **Dependency:** The worker deploy in step 5 must happen AFTER step 2 (migration apply). If deployed in the wrong order, the worker will throw a "no such column" error — caught by `onError`, returned as a structured 500 with a migration hint.
- **Concurrency:** Migration is safe to apply while the old worker is running — the old code's `columnExists()` check will simply return `true` after the migration, and it will include the new columns in the UPDATE.
- **Backup:** D1 automatically retains 30 days of backups on the paid plan; on the free plan, take a manual backup before applying:
  ```bash
  npx wrangler d1 export resumeai-pro-db --remote --output backup-pre-0006.sql
  ```

### Effort estimate
**S** (Small) — 1–2 hours total: 30 min for migration + verification, 30 min for code cleanup, 30 min for deploy + monitoring.

### Success metrics
- `PUT /api/settings/branding` p99 latency drops by ≥ 15ms (the `PRAGMA` overhead is gone).
- D1 query count on the branding endpoint drops by 50% (one query per request instead of two).
- Zero `migrationApplied: false` responses in production logs after deploy.

---

## P2 — CI/CD Pipeline Implementation

**Goal:** Automate the path from PR → test → build → deploy so that every change is validated before merge and every merge to `main` is deployed to Cloudflare without manual intervention.

### Why this is P2
Today, deploys are manual (`npx wrangler deploy` + `git push`). This means: (a) tests are only run locally before push — easy to skip, (b) the worker and Pages app can drift in deployed versions, (c) D1 migrations are applied manually and can be forgotten (this is exactly why migration 0006 was never applied to production). A CI/CD pipeline removes these failure modes and makes deployments boring.

### Implementation steps

1. **Create the GitHub Actions workflow file**
   - Path: `.github/workflows/ci.yml`
   - Triggers: `pull_request` to `main`, `push` to `main`.

2. **Define the CI jobs (run on every PR)**
   ```yaml
   jobs:
     lint:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v1
         - run: bun install --frozen-lockfile
         - run: bun run lint

     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v1
         - run: bun install --frozen-lockfile
         - run: bunx vitest run --reporter=github-actions

     build:
       runs-on: ubuntu-latest
       needs: [lint, test]
       steps:
         - uses: actions/checkout@v4
         - uses: oven-sh/setup-bun@v1
         - run: bun install --frozen-lockfile
         - run: bun run build
         - uses: actions/upload-artifact@v4
           with:
             name: build-output
             path: .next/
   ```

3. **Define the CD jobs (run only on merge to main)**
   ```yaml
   deploy-pages:
     runs-on: ubuntu-latest
     needs: build
     if: github.ref == 'refs/heads/main'
     steps:
       - uses: actions/checkout@v4
       - uses: cloudflare/pages-action@v1
         with:
           apiToken: ${{ secrets.CF_API_TOKEN }}
           accountId: ${{ secrets.CF_ACCOUNT_ID }}
           projectName: resumeai-pro
           directory: .next/
           gitHubToken: ${{ secrets.GITHUB_TOKEN }}

   deploy-worker:
     runs-on: ubuntu-latest
     needs: build
     if: github.ref == 'refs/heads/main'
     steps:
       - uses: actions/checkout@v4
       - uses: cloudflare/wrangler-action@v3
         with:
           apiToken: ${{ secrets.CF_API_TOKEN }}
           accountId: ${{ secrets.CF_ACCOUNT_ID }}
           command: deploy

   apply-migrations:
     runs-on: ubuntu-latest
     needs: deploy-worker
     if: github.ref == 'refs/heads/main'
     steps:
       - uses: actions/checkout@v4
       - uses: cloudflare/wrangler-action@v3
         with:
           apiToken: ${{ secrets.CF_API_TOKEN }}
           accountId: ${{ secrets.CF_ACCOUNT_ID }}
           command: d1 migrations apply resumeai-pro-db --remote
   ```

4. **Configure GitHub Secrets**
   - `CF_API_TOKEN` — Cloudflare API token with permissions: Pages (Edit), Workers (Edit), D1 (Edit). Scope to specific resources when possible.
   - `CF_ACCOUNT_ID` — the Cloudflare account ID.
   - Never commit these. Use GitHub's encrypted secrets UI or `gh secret set`.

5. **Set up branch protection**
   - In GitHub repo settings → Branches → `main`:
     - Require status checks to pass: `lint`, `test`, `build`.
     - Require branches to be up to date before merging.
     - Require 1 reviewer (or 0 if solo).
   - This prevents direct pushes to `main` — every change goes through PR.

6. **Add preview deployments for PRs**
   - Cloudflare Pages automatically generates a preview URL for each PR.
   - Add a comment bot (or use Cloudflare's built-in GitHub integration) to post the preview URL on the PR.

7. **Handle concurrent deploys**
   - Use `concurrency` groups to prevent two deploys from running simultaneously:
     ```yaml
     concurrency:
       group: deploy-production
       cancel-in-progress: false
     ```

8. **Add deploy-time smoke test**
   - After `deploy-worker`, hit `/api/health` and assert `db: "connected"`.
   - If the smoke test fails, the workflow fails (and notifies via GitHub Actions status).

### Risks / dependencies
- **Secret management:** The `CF_API_TOKEN` must have the minimum permissions needed. If it's too broad, a leaked token could compromise the entire Cloudflare account. Use a dedicated token scoped to just this project.
- **Migration ordering:** The `apply-migrations` job runs AFTER `deploy-worker`. This means the worker may briefly reference columns that don't exist yet. Mitigation: keep the `columnExists()` check in the worker code for one release cycle after P1 (then remove in a follow-up).
- **D1 migration failures:** If a migration fails (e.g. `ALTER TABLE` on a column that already exists), the deploy job fails but the worker is already deployed. Mitigation: all migrations should be idempotent (use `IF NOT EXISTS` where supported; SQLite doesn't support `IF NOT EXISTS` on `ADD COLUMN`, so wrap in a try/catch in the migration script or check `PRAGMA table_info` first).
- **Rollback:** GitHub Actions has no built-in rollback. If a deploy is bad, manually run `npx wrangler rollback` for the worker and `git revert` + redeploy for Pages.
- **Cost:** GitHub Actions free tier = 2,000 minutes/month for private repos. This workflow uses ~10 min per run; should be well within limits.

### Effort estimate
**M** (Medium) — 2–3 days: 1 day for the workflow file + testing, 0.5 day for secrets + branch protection, 0.5 day for preview deployments + smoke tests, 0.5 day for documentation.

### Success metrics
- 100% of PRs have passing `lint` + `test` + `build` checks before merge.
- Time-from-merge-to-production drops from "whenever someone remembers to deploy" to < 10 minutes.
- Zero manual `wrangler deploy` commands in a 2-week period after rollout.

---

## P3 — Real-time Pipeline Updates via WebSocket

**Goal:** Replace the current polling-based `PipelineDashboard` with a WebSocket subscription so agent status changes, progress updates, and completion events are pushed to the client in real time (≤ 100ms latency vs. current 1–2s polling interval).

### Why this is P3
The current dashboard polls the supervisor state every 1–2 seconds. This produces: (a) unnecessary network traffic (most polls return unchanged state), (b) UI jitter from re-renders, (c) latency between an agent completing and the user seeing it (up to 2s). WebSocket push eliminates all three. However, this is the largest effort item in the sprint and should be sequenced after the quick wins (P1, P2) are shipping.

### Implementation steps

1. **Choose the WebSocket architecture**
   - **Option A (recommended): Cloudflare Durable Objects.** Each pipeline run gets its own Durable Object instance. The DO holds the supervisor state and broadcasts diffs to subscribed clients. Pros: stateful, transactional, fits the pipeline model perfectly. Cons: requires Cloudflare Workers Paid plan ($5/month).
   - **Option B: Pages Functions with WebSocket Hibernation.** Cheaper, but state is eventually consistent across requests. Acceptable for low-volume pipelines.
   - **Recommendation:** Go with Option A. The $5/month cost is justified by the simpler programming model and lower latency.

2. **Design the event schema**
   - Define a discriminated union of event types:
     ```typescript
     type PipelineEvent =
       | { type: "agent_status"; agentId: AgentId; status: AgentStatus; log?: string; timestamp: string }
       | { type: "progress"; stepIndex: number; percent: number; etaSeconds: number }
       | { type: "agent_result"; agentId: AgentId; result: unknown }
       | { type: "pipeline_complete"; finalStatus: "completed" | "failed"; summary: string }
       | { type: "error"; agentId?: AgentId; message: string; recoverable: boolean };
     ```
   - All events are JSON-serializable and idempotent (receiving the same event twice is safe).

3. **Implement the Durable Object**
   - Path: `workers/pipeline-do/index.ts`
   - The DO stores:
     - The current `SupervisorState` (a single source of truth).
     - A `Set<WebSocket>` of connected clients.
   - Methods:
     - `fetch(request)`: handle WebSocket upgrade; on connect, send the current state as a snapshot.
     - `updateAgent(agentId, patch)`: called by the orchestrator; updates state and broadcasts an `agent_status` event to all clients.
     - `broadcast(event)`: serialize event as JSON, send to all connected WebSockets. Handle disconnects gracefully.
   - Use WebSocket Hibernation to reduce idle cost.

4. **Wire the orchestrator to the DO**
   - In `src/lib/agents/supervisor.ts`, replace the `setState()` function's listener-based broadcast with a DO call:
     ```typescript
     // Before: notify local listeners
     listeners.forEach((fn) => fn(state));
     // After: notify the DO, which broadcasts to all clients
     await fetch(`https://pipeline-do.${ACCOUNT_ID}.workers.dev/${pipelineId}/update`, {
       method: "POST",
       body: JSON.stringify({ agentId, patch }),
     });
     ```
   - The DO is the single source of truth; clients subscribe to it directly.

5. **Update the client (`PipelineDashboard.tsx`)**
   - Add a `usePipelineWebSocket(pipelineId)` hook:
     - Opens a WebSocket to `wss://pipeline-do.${ACCOUNT_ID}.workers.dev/${pipelineId}`.
     - On message: parse the event, dispatch to the appropriate Zustand store action.
     - On disconnect: exponential backoff reconnect (250ms → 500ms → 1s → 2s → 5s, cap at 5s).
     - On reconnect: request a full state snapshot to catch up on missed events.
   - Replace the polling `setInterval` with the WebSocket subscription.

6. **Keep polling as a fallback**
   - If the WebSocket fails to connect after 3 attempts, fall back to the existing polling logic.
   - This ensures the dashboard still works in restricted networks (some corporate proxies block WebSockets).

7. **Add a feature flag**
   - In `feature_flags` table: `pipeline_websocket_enabled` (boolean, default `false`).
   - Roll out to 10% of users → 50% → 100% over 1 week.
   - Allows instant rollback if WebSockets misbehave.

8. **Observability**
   - Log WebSocket connection counts and message rates to Cloudflare Analytics.
   - Add a `/api/pipeline-stats` endpoint that returns current connections, total messages sent, average latency.

### Risks / dependencies
- **Durable Objects require Workers Paid plan.** The free plan doesn't include DOs. Cost: $5/month base + $0.15/million requests + $12.50/million GB-sec. For a low-traffic app, expect < $10/month total.
- **WebSocket connection limits.** Browsers limit concurrent WebSocket connections per page (~30). This is fine for a single dashboard, but if the user opens many tabs, they'll hit the limit. Mitigation: use `BroadcastChannel` to share one WebSocket across tabs of the same origin.
- **Reconnection logic is tricky.** Must handle: temporary network drops, server restarts, DO eviction (hibernation). Use a monotonically increasing event sequence number so the client can detect gaps and request a snapshot.
- **State consistency.** The DO is the source of truth, but the orchestrator currently runs in the browser (via `supervisor.ts`). This creates a split-brain risk. Mitigation: move the orchestrator to the DO (longer-term refactor) OR have the browser orchestrator report state to the DO on every change (current plan).
- **Testing.** WebSocket integration tests are harder than HTTP tests. Use `msw` + `mock-socket` for unit tests; run an end-to-end test with a real DO in the `ci.yml` workflow.

### Effort estimate
**L** (Large) — 1.5–2 weeks: 3 days for the Durable Object + event schema, 3 days for the orchestrator wiring, 2 days for the client hook + UI updates, 2 days for fallback logic + feature flag, 2 days for testing + observability.

### Success metrics
- p95 latency between an agent status change and the UI reflecting it: ≤ 200ms (currently ~1.5s with polling).
- Network requests per pipeline run drop by ≥ 80% (from ~120 polls to ~1 WebSocket + occasional snapshots).
- Zero user-visible "stuck waiting" states (the WebSocket pushes completion events immediately).

---

## P4 — Multi-region Read Scaling

**Goal:** Reduce read latency for global users by serving cacheable reads from Cloudflare's edge locations, and prepare for native D1 read replicas when they become generally available.

### Why this is P4 (and why it's partially blocked)
As of 2026-06, Cloudflare D1 is single-region — every read goes to the primary D1 instance in one region. For users in other continents, this adds 100–300ms of latency per query. Cloudflare has announced read replicas on the roadmap but hasn't shipped GA. The interim solution (edge caching via Cache API + KV) is implementable today, but the full multi-region read story depends on Cloudflare's roadmap.

### Implementation steps

1. **Audit read-heavy endpoints**
   - Identify GET endpoints that are read frequently and updated rarely:
     - `GET /api/settings/branding` — read on every page load, updated rarely.
     - `GET /api/settings/flags` — read on every page load, updated rarely.
     - `GET /api/users` (admin only) — read on admin page load.
     - `GET /api/providers` — read on settings page load.
   - These are candidates for edge caching.

2. **Implement edge caching via Cloudflare Cache API**
   - For each read-heavy endpoint, wrap the handler:
     ```typescript
     app.get("/api/settings/branding", async (c) => {
       const cacheKey = new Request(c.req.url, c.req);
       const cache = caches.default;
       const cached = await cache.match(cacheKey);
       if (cached) return cached;

       // ... existing handler ...
       const response = c.json({ branding: result || {} });
       response.headers.set("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
       c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
       return response;
     });
     ```
   - TTL: 60s for branding/flags (acceptable staleness); 0 for user-specific data (no caching).

3. **Implement cache invalidation on write**
   - When `PUT /api/settings/branding` succeeds, purge the cache:
     ```typescript
     await cache.delete(new Request(`${c.req.url}`, c.req));
     ```
   - For finer-grained invalidation, use a cache-busting key (e.g. include a version number from the DB row).

4. **Move hot settings to KV (optional, for sub-50ms global reads)**
   - KV is globally distributed and reads in ~10ms from any edge.
   - Migrate `branding` and `feature_flags` to KV (with D1 as the source of truth, KV as the cache).
   - Write-through pattern: every D1 write also writes to KV.
   - Read pattern: read from KV first; on miss, read from D1 and backfill KV.

5. **Prepare for native D1 read replicas (when GA)**
   - Subscribe to Cloudflare's D1 changelog for the read replicas announcement.
   - When GA, the migration is mostly config:
     ```toml
     # wrangler.toml
     [[d1_databases]]
     binding = "DB"
     database_name = "resumeai-pro-db"
     database_id = "..."
     read_replicas = ["wnam", "enam", "weur", "eeur", "apac"]
     ```
   - Update the worker to route reads to the nearest replica and writes to the primary. The D1 binding will handle this automatically once replicas are configured.

6. **Add latency monitoring**
   - Log the `cf-cache-status` header on every response.
   - Track cache hit rate per endpoint in Cloudflare Analytics.
   - Set up an alert if cache hit rate drops below 70% (indicates either heavy writes or a cache invalidation bug).

### Risks / dependencies
- **D1 read replicas are not yet GA.** This is a hard external dependency. The interim solution (Cache API + KV) is implementable today, but won't give the same consistency guarantees as native replicas.
- **Cache invalidation is hard.** Forgetting to purge a cache entry on write leads to stale data. Mitigation: wrap all write handlers with a `purgeCache(keys)` call; add a unit test that verifies cache is purged after every write.
- **Eventual consistency.** Edge-cached reads can be up to 60s stale (the s-maxage). For branding/flags, this is acceptable. For user-specific data (resumes, cover letters), it's NOT acceptable — don't cache those.
- **Cost.** KV charges $0.50/million reads + $5/million writes. For the expected volume, this is < $5/month. Cache API is free.
- **Concurrency.** If two users write to branding simultaneously, the cache purges may interleave. The last purge wins; the cache will settle within 60s. This is acceptable.

### Effort estimate
**M** (Medium) — 3–5 days for the Cache API implementation: 1 day for endpoint audit, 2 days for caching + invalidation, 1 day for KV migration (optional), 1 day for monitoring.

**L** (Large) — 1–2 weeks if/when D1 read replicas ship and we migrate to them. This is a future sprint item.

### Success metrics
- p50 read latency for `GET /api/settings/branding` drops from ~150ms (origin) to ~20ms (edge cache hit).
- Cache hit rate ≥ 85% for branding and flags endpoints.
- Zero stale-data reports from users after a settings change (cache invalidation works correctly).

---

## Sprint Sequencing Summary

| Priority | Item | Effort | Week 1 | Week 2 |
|---|---|---|---|---|
| **P1** | D1 Migration 0006 + remove `columnExists()` | S | ✓ Day 1 | — |
| **P2** | CI/CD Pipeline (GitHub Actions) | M | ✓ Days 2–4 | — |
| **P3** | WebSocket pipeline updates | L | ✓ Days 5–7 (DO + schema) | ✓ Days 8–10 (client + testing) |
| **P4** | Multi-region read scaling (Cache API only) | M | — | ✓ Days 11–13 (stretch) |

**Buffer:** Days 14 is reserved for bug fixes, code review, and sprint demo.

**Definition of Done for each item:**
- P1: Migration applied, worker deployed, `columnExists()` removed, p99 latency improved.
- P2: `.github/workflows/ci.yml` merged, branch protection enabled, first auto-deploy to production succeeds.
- P3: WebSocket DO deployed, feature flag at 100%, p95 UI latency ≤ 200ms.
- P4: Cache API on 4 endpoints, cache hit rate ≥ 85%, latency dashboard live.

**Total engineering capacity needed:** ~2 weeks of one engineer's time. P4 is a stretch goal — if P3 overruns, defer P4 to the following sprint.
