/* Apollo service worker: caches the app shell so the app opens offline.
 * Bump VERSION on every change to any file in app/, or devices keep the old copy.
 * API calls go to another origin and are never intercepted. */
var VERSION = 'apollo-2026.10.08.1';
var SHELL = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERSION).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // One rule for every file, pages and assets alike: network first, revalidated past the
  // browser's HTTP cache, so a new page and its new script always arrive together. The
  // cached copy serves when offline, and the app shell is the last resort for a page.
  event.respondWith(
    caches.open(VERSION).then(function (cache) {
      return fetch(req, { cache: 'no-cache' }).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () {
        return cache.match(req, { ignoreSearch: true }).then(function (cached) {
          if (cached || req.mode !== 'navigate') return cached;
          return cache.match('./');
        });
      });
    })
  );
});
