const CACHE_NAME = 'attendease-v3';
const FILES_TO_CACHE = [
  './',
  'index.html',
  'styles/main.css',
  'scripts/main.js',
  'images/icons/icon-192x192.png',
  'images/icons/icon-512x512.png'
];

// Install event: cache the app shell
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force immediate activation for updates
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(FILES_TO_CACHE);
      })
  );
});

// Fetch event: Network First strategy to ensure latest changes are visible
self.addEventListener('fetch', (event) => {
  // We only want to handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If the request is successful, clone it, update the cache, and return the response
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // If network fetch fails (offline), fall back to cache
        return caches.match(event.request);
      })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim()); // Take control of all pages immediately
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});