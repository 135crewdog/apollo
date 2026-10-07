/* Apollo service worker: caches the app shell so the app opens offline.
 * Bump VERSION on every change to any file in app/, or devices keep the old copy.
 * API calls go to another origin and are never intercepted. */
var VERSION = 'apollo-2026.10.07.10';
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
  event.respondWith(
    caches.open(VERSION).then(function (cache) {
      if (req.mode === 'navigate') {
        // Pages (the app, the guide): network first so a new version shows at once; the
        // cached copy of the same page when offline; the app shell as a last resort.
        return fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () {
          return cache.match(req, { ignoreSearch: true }).then(function (cached) { return cached || cache.match('./'); });
        });
      }
      // Scripts, styles, icons: cached copy at once, refreshed in the background.
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
