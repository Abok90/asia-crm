const CACHE_NAME = 'asia-crm-v9';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/styles/main.css',
  './src/config.js',
  './src/helpers.js',
  './src/icons.jsx'
];

// URLs that should NEVER be cached (API calls, Supabase, etc.)
const NO_CACHE_PATTERNS = [
  'supabase.co',
  'supabase.in',
  '/api/',
  '/rest/',
  '/auth/',
  '/realtime/',
  '/storage/',
  'googleapis.com/token',
  'script.google.com'
];

function shouldCache(url) {
  return !NO_CACHE_PATTERNS.some(pattern => url.includes(pattern));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // لا نتدخل أبداً في طلبات Supabase / Auth / API — نتركها للمتصفح مباشرة
  // (يمنع أي تعارض مع تجديد التوكن وكوكيز الجلسة)
  if (!shouldCache(url)) {
    return;
  }

  // Network-First strategy for HTML/JS — ensures fresh content
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(event.request, responseClone))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => 
        caches.match(event.request)
          .then((cached) => cached || caches.match('./index.html'))
      )
  );
});

// Listen for skip-waiting message from the app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});