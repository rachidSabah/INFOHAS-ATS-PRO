---
Task ID: bugfix-cloudApiSafe-and-jd-stuck
Agent: main (Super Z)
Task: Fix `cloudApiSafe is not defined` runtime crash on PDF upload + JD parsing stuck + audit all browser features for similar bugs and fix them once and for all.

Work Log:
- Located the cloudApiSafe usages — 24 call sites in src/lib/store.ts call `cloudApiSafe(createResume)(r)` etc., but the function was never imported and `createResume` etc. were never destructured from `cloudApi`. Result: synchronous ReferenceError that crashed the page on PDF upload, JD creation, cover letter creation, prompt creation, branding update, audit log, etc.
- Ran `npx tsc --noEmit` to enumerate every related bug at compile time. Found 4 additional runtime bugs that tsc catches:
  1. `updateResume` undefined in Optimizer.tsx (lines 645, 676) — broken photo upload + live preview edit
  2. `toggleTheme` missing from AppState interface — broken theme toggle in TopBar, Settings, LandingFooter
  3. `ai-logs` view missing in AppShell VIEW_COMPONENTS — navigation crash if user reaches it
  4. `next.config.ts` — Next.js 16 removed the `api` config key
- Added `cloudApiSafe` export to src/lib/cloud-api.ts as a higher-order wrapper that swallows errors, handles undefined/null input, and never throws synchronously.
- Updated src/lib/store.ts imports: added `cloudApiSafe` to the import + destructured all 20 cloudApi methods so the existing call sites resolve.
- Added `toggleTheme` to the AppState interface.
- Added `const updateResume = useApp((s) => s.updateResume)` to Optimizer.tsx.
- Mapped `"ai-logs"` to `Logs` in AppShell VIEW_COMPONENTS.
- Removed the `api: { externalResolver: true }` block from next.config.ts (Next.js 16 incompatibility).
- Fixed JD parsing stuck: added `withTimeout()` helper in src/lib/ai.ts. Puter sign-in gets 8s, Puter chat gets 30s. On timeout, fall through to the next provider instead of hanging forever.
- Added 15s `AbortSignal.timeout` on the server `/api/jd-scrape` route fetch.
- Added 20s client-side `AbortController` in JDScraper.tsx with a user-friendly "paste manually" message on timeout.
- Wrote regression test src/lib/cloud-api.test.ts (7 tests) — verifies cloudApiSafe is exported, wraps functions correctly, swallows errors, handles undefined/null, never throws synchronously, and all 20 api.* methods are real functions.
- Test suite: 57 → 64 tests, all passing.
- `npx next build` succeeds with clean output (only warning is the now-fixed next.config.ts issue, removed before commit).

Stage Summary:
- Root cause of "cloudApiSafe is not defined": the previous fix commit `46e7db5` ("safe wrapper for cloud API calls") introduced the calls but never imported/defined the wrapper. This commit closes the loop.
- Root cause of JD parsing stuck: `await window.puter.auth.signIn()` opens a popup that may be blocked or dismissed silently, and the await never resolves. Combined with no timeout on `puter.ai.chat()`, the spinner could spin forever. Timeouts on both ends fix this permanently.
- All 5 user-facing bugs fixed. 7 regression tests added to prevent recurrence.
- Production build verified clean. Tests verified passing.
- Commit: bf948a6 on main branch.
