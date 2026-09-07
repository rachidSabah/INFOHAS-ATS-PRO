// Shared Puter.js SDK loader — singleton, on-demand, readiness-predicate based.
//
// WHY: The SDK is intentionally NOT loaded eagerly (no <script> in layout) to
// avoid Puter's auto WebSocket connection and console noise on every page
// view. The AI provider lazy-loads it when a Puter model is used. But the
// AuthModal's "Continue with Puter (free AI)" button ALSO needs the SDK —
// and on a first visit window.puter does not exist yet, so the old code
// failed with "Puter.js is not loaded. Please refresh the page and try
// again." (refreshing never helped because nothing eager-loads the script).
//
// This module is the single load path for every consumer (auth flow, AI
// provider). It injects https://js.puter.com/v2/ once, guards concurrent
// callers behind one promise, waits for a consumer-specific readiness
// predicate, applies the banner-quiet flag, and times out gracefully.

type PuterGlobal = any;

const SDK_URL = "https://js.puter.com/v2/";
const INIT_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 50;

let pending: Promise<PuterGlobal> | null = null;

/** Default readiness: the AI chat surface is available. */
const aiChatReady = (p: PuterGlobal) => !!p?.ai?.chat;
/** Auth readiness: the auth surface is available (sign-in flow). */
const authReady = (p: PuterGlobal) => !!p?.auth?.signIn;

function applyQuietFlag(puter: PuterGlobal) {
  try {
    if (puter && !(puter as any)._quietSet) {
      try {
        Object.defineProperty(puter, "quiet", { value: true, writable: true, configurable: true });
      } catch {
        puter.quiet = true;
      }
      (puter as any)._quietSet = true;
    }
  } catch {
    /* best-effort — banner suppression only */
  }
}

function waitForReadiness(ready: (p: PuterGlobal) => boolean): Promise<PuterGlobal> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = setInterval(() => {
      const puter = (typeof window !== "undefined" ? (window as any).puter : undefined) as PuterGlobal;
      if (ready(puter)) {
        clearInterval(poll);
        clearTimeout(timeout);
        applyQuietFlag(puter);
        resolve(puter);
        return;
      }
      if (Date.now() - startedAt > INIT_TIMEOUT_MS) {
        clearInterval(poll);
        clearTimeout(timeout);
        reject(new Error("Puter.js SDK failed to initialize"));
      }
    }, POLL_INTERVAL_MS);
    const timeout = setTimeout(() => {
      clearInterval(poll);
      reject(new Error("Puter.js SDK failed to initialize"));
    }, INIT_TIMEOUT_MS + POLL_INTERVAL_MS);
  });
}

/**
 * Ensure the Puter.js SDK is loaded and ready.
 *
 * @param surface "ai" (default) waits for puter.ai.chat; "auth" waits for
 *                puter.auth.signIn — use "auth" before triggering sign-in.
 * @returns the ready `window.puter` global.
 * @throws when the SDK cannot be loaded (offline) or does not initialize
 *         within the timeout window.
 */
export function ensurePuterLoaded(surface: "ai" | "auth" = "ai"): Promise<PuterGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Puter.js requires a browser environment"));
  }
  const ready = surface === "auth" ? authReady : aiChatReady;
  const existing = (window as any).puter as PuterGlobal | undefined;
  if (ready(existing)) {
    applyQuietFlag(existing);
    return Promise.resolve(existing);
  }
  // Collapse concurrent callers into ONE load. The readiness predicate may
  // differ per caller — the SDK initializes atomically, so whichever
  // predicate is satisfied first resolves everyone.
  if (!pending) {
    pending = new Promise<PuterGlobal>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => {
        waitForReadiness(ready).then(resolve, reject).finally(() => { pending = null; });
      };
      script.onerror = () => {
        pending = null;
        reject(new Error("Failed to load Puter.js SDK script"));
      };
      document.head.appendChild(script);
    });
  }
  return pending;
}
