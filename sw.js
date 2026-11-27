// Service worker: a small helper the browser runs in the background for the
// installed app. It keeps a copy of the app's own files so the app still opens
// without internet (the rates themselves always need a connection).
//
// Strategy: "network first". Online, you always get the newest version from
// GitHub Pages (and the saved copy is refreshed). Offline, the saved copy is used.
// Bank of Canada requests are NOT touched: they always go straight to the Bank.

// Changing this name makes every installed app throw away its old saved copy
const CACHE_NAME = "fx-rates-v2";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./holidays.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",
];

// Installed: save the app files.
// cache: "reload" = download fresh copies, not ones the browser kept from before.
self.addEventListener("install", (event) => {
  const freshRequests = APP_FILES.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(freshRequests)));
  self.skipWaiting(); // start working straight away
});

// Activated: delete saved copies from older versions (if CACHE_NAME changed)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Only handle our own files and the two libraries; let everything else
  // (the Bank of Canada API) go to the network as normal.
  const url = new URL(request.url);
  const isOwnFile = url.origin === self.location.origin;
  const isLibrary = APP_FILES.includes(request.url);
  if (!isOwnFile && !isLibrary) return;

  // GitHub Pages tells browsers they may reuse a file for 10 minutes, which
  // delayed updates. cache: "no-cache" makes the browser check with GitHub
  // every time; if nothing changed, GitHub answers "not modified" (very quick).
  // (A new Request is needed: page-opening requests can't be given options directly.)
  // The two libraries never change at a given version, so they're fetched normally.
  const networkRequest = isOwnFile ? new Request(request.url, { cache: "no-cache" }) : request;

  event.respondWith(
    fetch(networkRequest)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // Offline: use the saved copy (ignoring "?..." on the address)
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
