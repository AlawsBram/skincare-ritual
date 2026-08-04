/* ============================================================
   Skincare Ritual — Service Worker
   Offline caching + notification click handling.

   NOTE: bump CACHE_VERSION whenever you change any cached file,
   otherwise phones will keep serving the old copy from cache.
   ============================================================ */

var CACHE_VERSION = 'skincare-v2';

var ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon.svg',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png'
];

/* ---------- Install: pre-cache the shell ---------- */

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function (cache) {
            // addAll fails the whole install if any single file 404s, so add
            // them individually and tolerate misses.
            return Promise.all(ASSETS.map(function (url) {
                return cache.add(url).catch(function () {
                    console.warn('[sw] could not cache', url);
                });
            }));
        }).then(function () {
            return self.skipWaiting();   // activate the new SW immediately
        })
    );
});

/* ---------- Activate: drop old caches ---------- */

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                if (key !== CACHE_VERSION) return caches.delete(key);
            }));
        }).then(function () {
            return self.clients.claim();   // take control of open pages
        })
    );
});

/* ---------- Fetch: network-first, cache as fallback ----------
   Network-first means you always get the newest version when online,
   and the cached copy keeps the app working on a plane or in a lift. */

self.addEventListener('fetch', function (event) {
    var req = event.request;

    if (req.method !== 'GET') return;
    if (!req.url.startsWith('http')) return;   // skip chrome-extension:// etc.

    event.respondWith(
        fetch(req).then(function (res) {
            // Only cache successful same-origin responses
            if (res && res.status === 200 && res.type === 'basic') {
                var copy = res.clone();
                caches.open(CACHE_VERSION).then(function (cache) {
                    cache.put(req, copy);
                });
            }
            return res;
        }).catch(function () {
            return caches.match(req).then(function (cached) {
                if (cached) return cached;
                // Navigation with nothing cached → fall back to the app shell
                if (req.mode === 'navigate') return caches.match('./index.html');
                return new Response('Offline', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            });
        })
    );
});

/* ---------- Notification click: focus or open the app ---------- */

self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function (clientList) {
                // Reuse an already-open window if there is one
                for (var i = 0; i < clientList.length; i++) {
                    var client = clientList[i];
                    if ('focus' in client) return client.focus();
                }
                if (self.clients.openWindow) return self.clients.openWindow('./');
            })
    );
});

/* ---------- Push (optional, for a future server-backed version) ----------
   Not used by this build — the alarms run in the page via setTimeout.
   This handler is here so that if you later add a push server with VAPID
   keys, notifications will already be wired up on the client side. */

self.addEventListener('push', function (event) {
    var data = { title: 'Skincare Ritual', body: 'Time for your routine.' };
    if (event.data) {
        try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            data: { url: './' }
        })
    );
});

/* ---------- Message channel: let the page schedule via the SW ---------- */

self.addEventListener('message', function (event) {
    if (!event.data) return;

    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    // The page asks the SW to show a notification. Going through the SW is
    // required on iOS, where `new Notification()` is not available.
    if (event.data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(event.data.title, {
            body: event.data.body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: event.data.tag,
            data: { url: './' }
        });
    }
});
