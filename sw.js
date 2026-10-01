/**
 * sw.js — Service Worker для PWA UniSchedule ФИиИТ
 * Обеспечивает кеширование локальных ресурсов и CDN-библиотек (SheetJS, jsPDF)
 * для 100% офлайн-доступа к расписанию занятий.
 */

const CACHE_NAME = 'unischedule-fiiit-v1.5';

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './parser.js',
  './app.js',
  './manifest.json',
  './icon.svg',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// Установка: кеширование статических файлов
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Прекеширование статических ресурсов и CDN...');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Не удалось прекешировать некоторые ресурсы:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Активация: очистка старых версий кеша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Удаление устаревшего кеша:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват сетевых запросов: Cache-First с сетевым фолбэком
self.addEventListener('fetch', (event) => {
  // Игнорируем неподдерживаемые схемы (например, chrome-extension://)
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // Если ответ валидный, сохраняем копию в кеш
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Если сеть недоступна и ресурса нет в кеше, для HTML-запросов возвращаем index.html
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
          }
        });
    })
  );
});
