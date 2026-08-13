/* أوريون · توونز — Service Worker
   يمكّن العمل دون اتصال بالإنترنت وتخزين الأصول مؤقتاً.
   ضعه بجانب orion-toons-v2.html على نفس الجذر. */
const CACHE = 'orion-v1';
const CORE = [
  './',
  './orion-toons-v2.html',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* إستراتيجية: الشبكة أولاً، مع الرجوع للكاش (للصور الخارجية تُخزَّن عند أول نجاح) */
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      if(res.ok && (req.url.startsWith('http'))) {
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./orion-toons-v2.html')))
  );
});
