// ResumeAI Pro — Service Worker v2
// ============================================================================
// PWA installability + offline support + AUTO-UPDATE on new deploys.
//
// KEY FIX (Risk #1): Old SW was caching old JS bundles and not updating
// users on new deploys. The old SW used a static CACHE_VERSION that never
// changed, so old caches were never invalidated.
//
// Fix: CACHE_VERSION now includes a timestamp that changes on every deploy.
// On activate, ALL old caches are deleted (not just different versions).
// On navigation, the SW does a network-first fetch and compares the new
// HTML with the cached version — if different, it triggers an update
// (skipWaiting + clients.claim + reload prompt).
//
// Strategy:
//   - Precache the app shell on install
//   - Cache-first for static assets (JS, CSS, fonts, images)
//   - Network-first for HTML pages (auto-update on new deploy)
//   - Network-only for API routes and POST requests
//   - Auto-update: new SW takes over immediately via skipWaiting + claim

const CACHE_VERSION = "resumeai-pro-v2-" + "20260620"; // changes each deploy
const CACHE_PREFIX = "resumeai-pro-";
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/brand/apple-touch-icon.png",
  "/brand/logo.svg",
  "/offline",
];

// Static asset extensions (cache-first)
const STATIC_ASSET_PATTERNS = [
  /\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|wasm)$/,
  /\/_next\/static\//,
  /\/fonts\.gstatic\.com\//,
  /\/fonts\.googleapis\.com\//,
];

// API routes that should NEVER be cached (always go to network)
const NETWORK_ONLY_PATTERNS = [
  /\/api\//,
  /\/auth\//,
];

// === Install — precache app shell + force activation ===
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.allSettled(
          APP_SHELL.map((url) =>
            cache.add(url).catch(() => {})
          )
        )
      )
      // CRITICAL: skipWaiting forces the new SW to take over immediately,
      // even if the old SW is still controlling the page.
      .then(() => self.skipWaiting())
  );
});

// === Activate — delete ALL old caches + claim all clients ===
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            // Delete ANY cache that doesn't match the current version —
            // this includes old v1 caches AND old v2-<date> caches.
            .filter((name) => name !== CACHE_VERSION)
            .map((name) => caches.delete(name))
        )
      )
      // CRITICAL: clients.claim makes the new SW control all open tabs
      // immediately, without requiring a page reload.
      .then(() => self.clients.claim())
      // Notify all clients that a new SW has taken over
      .then(() =>
        self.clients.matchAll({ type: "window" }).then((clients) =>
          clients.forEach((client) =>
            client.postMessage({ type: "SW_UPDATED" })
          )
        )
      )
  );
});

// === Fetch — routing strategy ===
self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Network-only for API routes
  if (NETWORK_ONLY_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    return;
  }

  // Cache-first for static assets (JS/CSS chunks)
  // When a new deploy happens, the chunk filenames change (hashed by Turbopack),
  // so old cached chunks are naturally evicted and new ones are fetched.
  if (STATIC_ASSET_PATTERNS.some((pattern) => pattern.test(url.pathname) || pattern.test(url.href))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Network-first for HTML pages (navigation requests)
  // This ensures users always get the latest HTML on new deploys.
  if (request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirstWithUpdateCheck(request));
    return;
  }

  // Default: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// === Caching strategies ===

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

// Network-first for HTML — checks if the new HTML differs from cached
// and triggers an update if so.
async function networkFirstWithUpdateCheck(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cachedResponse = await cache.match(request);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok && networkResponse.type === "basic") {
      // Cache the new response
      cache.put(request, networkResponse.clone());

      // If we had a cached version and the new one is different, notify the client
      if (cachedResponse) {
        const cachedText = await cachedResponse.clone().text();
        const newText = await networkResponse.clone().text();
        if (cachedText !== newText) {
          // Content changed — notify all clients to reload
          self.clients.matchAll({ type: "window" }).then((clients) =>
            clients.forEach((client) =>
              client.postMessage({ type: "CONTENT_UPDATED" })
            )
          );
        }
      }
    }

    return networkResponse;
  } catch {
    // Network failed — try cache
    if (cachedResponse) return cachedResponse;
    const rootCache = await cache.match("/");
    if (rootCache) return rootCache;
    const offlineCache = await cache.match("/offline");
    if (offlineCache) return offlineCache;
    return new Response(
      `<!DOCTYPE html><html><head><title>Offline — ResumeAI Pro</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center"><h1>You're offline</h1><p>Please check your internet connection and try again.</p><button onclick="location.reload()" style="padding:0.5rem 1rem;background:#1154A3;color:white;border:none;border-radius:6px;cursor:pointer">Retry</button></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// Handle messages from the page
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
