/* Versioned offline bundle. Only this app's old caches are removed. */
const CACHE_NAME = 'unischedule-fiiit-planner-v2.1';
const STATIC_ASSETS = [
  './', './index.html', './styles.css', './parser.js', './app.js',
  './manifest.json', './icon.svg', './fonts/golos.css',
  './vendor/xlsx.full.min.js', './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(STATIC_ASSETS);
    const css = await (await cache.match('./fonts/golos.css')).text();
    const fonts = [...css.matchAll(/url\(([^)]+)\)/g)].map(match => new URL(match[1].replace(/["']/g, ''), new URL('./fonts/', self.location.href)).href);
    await cache.addAll([...new Set(fonts)]);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('unischedule-fiiit-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') return await cache.match('./index.html');
      return Response.error();
    }
  })());
});
