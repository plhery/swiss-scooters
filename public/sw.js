const CACHE_PREFIX = "zurich-scooter";
const APP_CACHE = `${CACHE_PREFIX}-app-v1`;
const ASSET_CACHE = `${CACHE_PREFIX}-assets-v1`;
const APP_SHELL_URL = new URL("/", self.location.origin).toString();
const UPDATE_MARKER_URL = new URL(
  "/__pwa-update-pending__",
  self.location.origin
).toString();
const PUBLIC_ASSET_PATHS = new Set([
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/manifest.json",
]);
const MAX_ASSET_ENTRIES = 80;

let shellRefreshPromise = null;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const [appCache, assetCache] = await Promise.all([
        caches.open(APP_CACHE),
        caches.open(ASSET_CACHE),
      ]);
      const shellResponse = await fetch(
        new Request(APP_SHELL_URL, { cache: "reload" })
      );

      if (!shellResponse.ok) {
        throw new Error("Could not cache the app shell");
      }

      await appCache.put(APP_SHELL_URL, shellResponse);
      await Promise.all(
        [...PUBLIC_ASSET_PATHS].map(async (path) => {
          const url = new URL(path, self.location.origin).toString();
          const response = await fetch(new Request(url, { cache: "reload" }));
          if (response.ok) await assetCache.put(url, response);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const activeCaches = new Set([APP_CACHE, ASSET_CACHE]);
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (name) => name.startsWith(`${CACHE_PREFIX}-`) && !activeCaches.has(name)
          )
          .map((name) => caches.delete(name))
      );

      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Navigation preload is an optional optimization.
        }
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    const refresh = refreshAppShell(request, event.preloadResponse);
    event.waitUntil(refresh.then(() => undefined));
    event.respondWith(serveAppShell(refresh));
    return;
  }

  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      PUBLIC_ASSET_PATHS.has(url.pathname))
  ) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CHECK_FOR_UPDATE") return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      if (await cache.match(UPDATE_MARKER_URL)) {
        event.source?.postMessage({ type: "APP_UPDATED" });
        return;
      }

      await refreshAppShell(
        new Request(APP_SHELL_URL, { cache: "no-store" })
      );
    })()
  );
});

async function serveAppShell(refresh) {
  const cache = await caches.open(APP_CACHE);
  const [cached, updatePending] = await Promise.all([
    cache.match(APP_SHELL_URL),
    cache.match(UPDATE_MARKER_URL),
  ]);

  if (cached) {
    // If an update was prepared during an earlier launch, this response is the
    // new shell. Clearing the marker prevents a second, unnecessary reload.
    if (updatePending) await cache.delete(UPDATE_MARKER_URL);
    return cached;
  }

  return (
    (await refresh) ??
    new Response("The app is unavailable offline until it has loaded once.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

function refreshAppShell(request, preloadResponse) {
  if (shellRefreshPromise) return shellRefreshPromise;

  shellRefreshPromise = (async () => {
    const cache = await caches.open(APP_CACHE);
    const cached = await cache.match(APP_SHELL_URL);

    try {
      const preloaded = preloadResponse ? await preloadResponse : null;
      const fresh =
        preloaded ??
        (await fetch(new Request(request, { cache: "no-store" })));

      if (!fresh.ok) return null;

      const changed = cached
        ? (await cached.clone().text()) !== (await fresh.clone().text())
        : false;

      await cache.put(APP_SHELL_URL, fresh.clone());

      if (changed) {
        await cache.put(UPDATE_MARKER_URL, new Response("pending"));
        await broadcastUpdate();
      }

      return fresh;
    } catch {
      return null;
    }
  })().finally(() => {
    shellRefreshPromise = null;
  });

  return shellRefreshPromise;
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (!response.ok) return response;

  await cache.put(request, response.clone());
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(keys.length - MAX_ASSET_ENTRIES, 0)).map((key) =>
      cache.delete(key)
    )
  );
  return response;
}

async function broadcastUpdate() {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clients) {
    client.postMessage({ type: "APP_UPDATED" });
  }
}
