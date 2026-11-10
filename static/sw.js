'use strict';
const CACHE = 'chatroom-static-v1';
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE));
});
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key !== CACHE)
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (!url.pathname.startsWith('/static/')) return;
    event.respondWith(
        caches.open(CACHE).then(cache => cache.match(req).then(hit => {
            const network = fetch(req).then(res => {
                if (res && res.ok) cache.put(req, res.clone());
                return res;
            }).catch(() => hit);
            return hit || network;
        }))
    );
});
