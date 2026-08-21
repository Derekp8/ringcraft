const SHELL_CACHE_PREFIX = "ringcraft-shell-";
const buildKey = (new URL(self.location.href).searchParams.get("build") || "static")
  .replace(/[^a-zA-Z0-9._-]/g, "_")
  .slice(0, 120);
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${buildKey}`;
const scopeUrl = new URL("./", self.registration.scope);
const manifestUrl = new URL("manifest.webmanifest", scopeUrl);
const iconUrls = [
  new URL("icons/ringcraft-192.png", scopeUrl),
  new URL("icons/ringcraft-512.png", scopeUrl),
  new URL("icons/ringcraft-maskable-512.png", scopeUrl),
];

function isInScope(url) {
  return url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname);
}

async function fetchAndCache(cache, url, options = {}) {
  const response = await fetch(url, options);
  if (response.ok) await cache.put(url, response.clone());
  return response;
}

async function precacheApplicationShell() {
  const cache = await caches.open(SHELL_CACHE);
  const shellResponse = await fetch(scopeUrl, { cache: "reload" });
  if (!shellResponse.ok) throw new Error(`Ringcraft shell request failed: ${shellResponse.status}`);
  await cache.put(scopeUrl, shellResponse.clone());

  const html = await shellResponse.text();
  const discovered = new Set([manifestUrl.href, ...iconUrls.map((url) => url.href)]);
  for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
    try {
      const url = new URL(match[1], scopeUrl);
      if (isInScope(url) && url.protocol.startsWith("http")) discovered.add(url.href);
    } catch {
      // Ignore malformed/non-URL metadata; explicit shell resources are still cached.
    }
  }

  await Promise.all([...discovered].map(async (href) => {
    try { await fetchAndCache(cache, href, { cache: "reload" }); }
    catch { /* Optional asset failure does not discard the cached HTML shell. */ }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await precacheApplicationShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isInScope(url)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(scopeUrl, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || (await cache.match(scopeUrl)) || Response.error();
      }
    })());
    return;
  }

  const cacheableDestinations = new Set(["script", "style", "image", "font", "manifest"]);
  if (!cacheableDestinations.has(request.destination)) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      return await fetchAndCache(cache, request);
    } catch {
      return Response.error();
    }
  })());
});
