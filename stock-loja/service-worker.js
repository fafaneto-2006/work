const CACHE_NAME = 'stock-loja-v19';
const APP_FILES = ['./', './index.html', './styles.css', './sold-button.css', './platform-install.css', './auth.css', './auth.js', './supabase-config.js', './app.js', './pos.js', './pos.css', './profit.js', './tabs.js', './assistant.js', './assistant.css', './tabs.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)); }
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  }));
});
