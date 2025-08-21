// public/sw.js

/* =============================
   Service Worker for PWA
   ============================= */

const CACHE_VERSION = "v1.0.2";
const CACHE_NAME = `rsbm-${CACHE_VERSION}`;

const PRE_CACHE = [
  "/", // 首頁
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
];

// ========== Install ==========
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
  self.skipWaiting();
});

// ========== Activate ==========
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

// ========== Fetch ==========
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只處理 GET
  if (req.method !== "GET") return;

  // Next.js build 資源：Network First
  const sameOrigin = url.origin === location.origin;
  const isNextAsset =
    sameOrigin &&
    (url.pathname.startsWith("/_next/") || url.pathname.endsWith(".js"));

  if (isNextAsset) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 同源其他資源：Cache First
  if (sameOrigin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 第三方：Network First（失敗再回 Cache）
  event.respondWith(networkFirst(req));
});

// ========== Strategies ==========
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const copy = fresh.clone();
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, copy);
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;

    // 如果是首頁，回傳快取的 "/"
    if (new URL(req.url).pathname === "/") {
      const fallback = await caches.match("/");
      if (fallback) return fallback;
    }

    return Response.error();
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    const copy = fresh.clone();
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, copy);
    return fresh;
  } catch (err) {
    return Response.error();
  }
}
