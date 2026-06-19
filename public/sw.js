// ResumeAI Pro — Service Worker
// ============================================================================
// Enables PWA installability (Android Chrome install prompt) + basic offline
// support. Hand-rolled (no Workbox/Serwist dependency) for maximum
// compatibility with Cloudflare Pages' edge runtime.
//
// Strategy:
//   - Precache the app shell (/, /manifest.json, icons) on install
//   - Cache-first for static assets (JS, CSS, fonts, images, icons)
//   - Network-first for HTML pages (fall back to cache when offline)
//   - Network-only for API routes and POST requests (never cache)
//   - Background sync for failed form submissions (future enhancement)

const CACHE_VERSION = "resumeai-pro-v1";
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

// Install — precache the app shell
self.addEventListener("install", (event) => {
  console.log("[SW] Installing service worker v", CACHE_VERSION);
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => {
        // Use addAll with fail-tolerant adding (some assets may 404 in dev)
        return Promise.allSettled(
          APP_SHELL.map((url) =>
            cache.add(url).catch((err) => {
              console.warn("[SW] Failed to precache:", url, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating service worker v", CACHE_VERSION);
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_VERSION)
            .map((name) => {
              console.log("[SW] Deleting old cache:", name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch — routing strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip cross-origin requests (Puter.js CDN, etc.) — let the browser handle them
  if (url.origin !== self.location.origin) return;

  // Network-only for API routes
  if (NETWORK_ONLY_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    return; // fall through to browser default (network)
  }

  // Cache-first for static assets
  if (STATIC_ASSET_PATTERNS.some((pattern) => pattern.test(url.pathname) || pattern.test(url.href))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Network-first for HTML pages (navigation requests)
  if (request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirstWithOfflineFallback(request));
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
  } catch (err) {
    // Return a basic offline response for failed asset requests
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Network failed — try cache
    const cached = await caches.match(request);
    if (cached) return cached;
    // Try cached root page (app shell)
    const rootCache = await caches.match("/");
    if (rootCache) return rootCache;
    // Last resort: offline page
    const offlineCache = await caches.match("/offline");
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

// Allow the page to trigger immediate activation (skipWaiting)
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
