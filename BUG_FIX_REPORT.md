# Scan, Debug & Fix Report — INFOHAS-ATS-PRO

**Date:** 2026-07-17
**Scope:** Surface + deep scan for errors/bugs across the codebase; fix real errors + safe
enhancements only; preserve all features (no regressions, no degradation).
**Result:** 1 HIGH, 2 MEDIUM bugs fixed; 4 dead lint directives cleaned; 0 build/typecheck
errors; production build passes.

---

## Verification gate (run before & after fixes)

| Check | Command | Before | After |
|---|---|---|---|
| TypeScript typecheck | `npx tsc --noEmit` | exit 0 (clean) | exit 0 (clean) |
| Lint | `npx eslint .` | 0 errors, 6 warnings | 0 errors, 2 warnings* |
| Production build | `npm run build` | (not run) | exit 0 (success) |

\* The 2 remaining warnings are in the **auto-generated** `worker-configuration.d.ts`
(Cloudflare Workers type defs) and were intentionally left untouched — editing a generated
file is unsafe and would be overwritten on regeneration.

---

## Surface scan

Method: `tsc --noEmit`, `eslint .`, plus manual verification of every `@/components/shared`
named import, all 175 `Icon` names against `lucide-react`, all `setView(...)` literals against
the `ViewKey` union + `VIEW_COMPONENTS` map, all `CareerTools` exports, and the four root
configs (`tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `eslint.config.mjs`).

**HIGH / MEDIUM: none.**
**LOW:** `tailwind.config.ts` `content` globs point at `./pages|./components|./app` but source is
under `./src`. Under Tailwind v4 (installed) the `content` key is ignored in favor of source
auto-detection, so this is stale/redundant config, **not** a build error. Left unchanged to
avoid risk.

---

## Deep scan

Method: reviewed store slices, interview/session hooks, polling/timer hooks, SPA navigation
model (`setView`), Zustand selectors, fetch/route targets, and DOM nesting.

### FIXED

#### F1 — HIGH: Device Check link escaped the SPA (full-page reload, lost state)
- **File:** `src/components/app/modules/Interview.tsx` (was line ~351)
- **Symptom:** `<a href="/interview/device-check">` triggered a hard navigation to a standalone
  Next.js route rendered outside `AppShell`. The entire app is a Zustand SPA (`setView`-driven);
  this reload wiped the in-memory store (resume/JD/interview selections, theme, session) and
  forced re-auth. It was the only `<a href>` in the codebase.
- **Fix:** Replaced the anchor with a `Dialog` that renders the existing `DeviceCheck` component
  in-app (added `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription` imports
  + `DeviceCheck` import, a `deviceCheckOpen` state, and the dialog trigger). Feature preserved;
  no reload; store state retained. The `/interview/device-check` route itself was kept intact.
- **Verified:** `tsc` clean, `eslint` 0 errors, `next build` includes `/interview/device-check`
  route unchanged.

#### F2 — MEDIUM: `useAIProviders` returned a new array each render (latent infinite loop)
- **File:** `src/lib/ai.ts` (`useAIProviders`)
- **Symptom:** `useApp((s) => s.providers.filter(...).sort(...))` built a new array reference on
  every store read. Zustand/React 19 `useSyncExternalStore` requires a referentially stable
  snapshot → "getSnapshot should be cached" warning and a potential infinite re-render loop once
  this hook is adopted by a component. (Currently unused, so latent.)
- **Fix:** Wrapped the selector in `useShallow` from `zustand/react/shallow`.
- **Verified:** `tsc` clean, `eslint` 0 errors.

#### F3 — MEDIUM: interview countdown effect re-subscribed every render
- **File:** `src/components/interview/VideoInterviewSession.tsx`
- **Symptom:** `startRecording` depended on `speech` and `previewMeter` objects whose identity
  changes every render (the hooks return fresh object literals). The `countdown` effect depended
  on `startRecording`, so its `setInterval` was torn down and recreated on every render — during
  countdown `setRecCountdown` fires every 100 ms, making the effect re-entrant/fragile and able
  to double-fire `startRecording()`.
- **Fix:** Destructured the stable `useCallback`s (`startMeter`/`stopMeter` from `previewMeter`;
  `startSpeech`/`stopSpeech`/`resetSpeech` from `speech`) and used those in the call sites and
  dependency arrays. The effect no longer re-subscribes per render.
- **Verified:** `tsc` clean, `eslint` 0 errors.

#### F4 — LOW: dead `eslint-disable` directives
- **Files:** `ConnectAntigravityDialog.tsx:77`, `AviationAcademy.tsx:192,291`,
  `useATSMatchScore.ts:71`
- **Fix:** Removed 4 unused `// eslint-disable-next-line react-hooks/exhaustive-deps` directives
  (their dependency arrays were already correct). The 2 in generated `worker-configuration.d.ts`
  were left untouched.
- **Verified:** eslint warnings dropped 6 → 2 (both generated-file only).

### REVIEWED, NOT CHANGED (non-errors / would risk regressions)

- **`src/lib/d1-integrity.ts`** fetches `/api/resumes` (no such route) — wrapped in try/catch,
  non-fatal, branch is dead. Left as-is to avoid touching D1/worker scope.
- **`src/hooks/useTaskPolling.ts`** invokes an async `fetchStatus()` inside a `setTask` updater —
  works today; the terminal-status `useEffect` stops polling. Low risk; changing risks behavior.
- **`tailwind.config.ts` `content` globs** — v4 auto-detects source; not a build error.

---

## Features preserved (regression check)

- Interview Prep "Start Video Interview" live preview (black-frame fix from prior session) — intact.
- Application Tracker prev/next + browser-Back history (prior session) — intact.
- All 30+ CareerTools modules, all `setView` navigations, all API routes — build compiles all of them.
- `/interview/device-check` standalone route — still present (Dialog is an additional, in-app path).

---

## Next steps

Commit → push to `origin/master` (GitHub) → deploy to Cloudflare Pages (`resumeai-pro`).
