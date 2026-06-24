// ProAnbud service worker — conservative, network-first.
// Purpose: make the app installable (PWA) and give a usable offline fallback,
// WITHOUT ever serving stale app code. Online users always get fresh responses;
// offline users get the last page they visited (or the app shell).
const CACHE = "proanbud-shell-v1"

self.addEventListener("install", () => {
  // Activate this SW immediately on first install / update.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Network-first only for page navigations. Everything else falls through to
  // the browser/network as normal so we never cache or stale-serve JS/CSS/data.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(CACHE)
          cache.put(req, fresh.clone())
          return fresh
        } catch {
          const cache = await caches.open(CACHE)
          const cached = (await cache.match(req)) || (await cache.match("/"))
          return cached || Response.error()
        }
      })()
    )
  }
})
