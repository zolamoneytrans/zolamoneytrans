// sw.js — Service Worker Zola Money Trans (Network First)
const CACHE_NAME = 'zola-v19';
const STATIC_ASSETS = [
  '/js/tutorial.js',
  '/',
  '/index.html',
  '/auth.html',
  '/dashboard.html',
  '/transfer.html',
  '/bills.html',
  '/kyc.html',
  '/merchant.html',
  '/admin.html',
  '/help.html',
  '/settings.html',
  '/transfer_processing.html',
  '/css/main.css',
  '/css/components.css',
  '/css/animations.css',
  '/js/app.js',
  '/js/firebase.js',
  '/js/dashboard.js',
  '/js/transfer.js',
  '/js/bills.js',
  '/js/kyc.js',
  '/js/merchant.js',
  '/js/admin.js',
  '/js/help.js',
  '/js/settings.js',
  '/js/transfer_processing.js',
  '/manifest.json',
  '/icons/zolalogo96x96.png',
  '/icons/zolalogo128x128.png',
  '/icons/zolalogo192x192.png',
];

// Installation — pré-cacher les assets statiques
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// Écoute pour mettre à jour manuellement le service worker
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activation — nettoyer les anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Stratégie : Network First (fallback cache)
// Les requêtes Firebase (googleapis) ne passent jamais par le cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ne jamais intercepter les requêtes Firebase, CDN, ou cross-origin
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('chart.js') ||
    !url.hostname.includes(self.location.hostname)
  ) {
    return; // Laisser le browser gérer
  }

  // Network first pour les fichiers HTML et JS (toujours à jour)
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname === '/'
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache first pour les assets statiques (CSS, images, fonts)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
