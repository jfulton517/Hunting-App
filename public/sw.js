// Offline support for the app itself. Forecast, stands, bucks and hunt logs are saved on the
// phone by the app; this keeps the app's own files available with no signal.
const CACHE = 'huntcast-v3';
// Script tags request files differently from install (CORS / Vary headers); match on URL only.
const MATCH = { ignoreVary: true };
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Also save the app's scripts and styles now, so it opens offline even if the
      // hunter never opened every screen while they had signal.
      try {
        const html = await (await fetch('./index.html', { cache: 'no-cache' })).text();
        const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => './' + m[1]);
        await cache.addAll(assets);
      } catch {
        /* cached as they're used instead */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Network with a time limit, so one bar of signal doesn't leave the app hanging. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (r) => {
        clearTimeout(id);
        resolve(r);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      },
    );
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Built files have content hashes in their names and never change: cache first.
  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(req, MATCH).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Pages and other files: try the network briefly (to pick up updates), else the saved copy.
  e.respondWith(
    fetchWithTimeout(req, 4000)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, MATCH).then((r) => r || caches.match('./index.html', { ignoreVary: true, ignoreSearch: true }))),
  );
});
