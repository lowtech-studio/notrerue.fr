// Service worker de NotreRue.fr.
// - Navigation (HTML) : réseau d'abord, secours sur le cache puis sur
//   /offline.html si rien n'est disponible — on ne veut jamais servir une
//   page HTML périmée quand le réseau fonctionne.
// - Autres requêtes GET same-origin (CSS, images, icônes…) : "stale while
//   revalidate" pour rester rapide et fonctionner hors-ligne, tout en
//   rafraîchissant le cache en arrière-plan (RWEB0060).
const CACHE_NAME = "notrerue-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/offline.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        )
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (
    request.method !== "GET" ||
    !request.url.startsWith(self.location.origin)
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) =>
          cached ?? caches.match(OFFLINE_URL)
        )
      ),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);

      return cached ?? network;
    }),
  );
});
