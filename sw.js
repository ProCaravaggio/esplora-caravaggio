const CACHE_NAME = "mappacaravaggio-v6";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",

  "./poi.json",
  "./itinerari.geojson",

  "./guida.html",
  "./privacy.html",
  "./note-legali.html",
  "./legal.css",

  "./manifest.webmanifest",
  "./icons/favicon-32.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Cache-first SOLO per i tuoi file (stesso dominio)
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
