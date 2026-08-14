/* أوريون · توونز — Service Worker آمن
   الشبكة أولاً دائماً (لا تخزين قديم) — يضمن أحدث نسخة من الموقع */
const CACHE = 'orion-v3';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // الشبكة أولاً، وبدون أي تخزين مؤقت للملفات (يضمن التحديث الفوري)
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
