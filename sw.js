/* Hedaf offline cache. Version bumps bust the cache. */
const CACHE = 'hedaf-v3';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'css/fonts.css', 'js/app.js', 'js/core.js', 'js/i18n.js', 'assets/logo.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'manifest.webmanifest',
  'assets/fonts/sora-400.woff2', 'assets/fonts/sora-600.woff2', 'assets/fonts/sora-800.woff2', 'assets/fonts/tajawal-400.woff2', 'assets/fonts/tajawal-500.woff2', 'assets/fonts/tajawal-700.woff2', 'assets/fonts/tajawal-800.woff2'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('hedaf-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
