// Service Worker for CF RSS Reader
// Cache-first strategy for app shell, network-first for articles

const APP_CACHE = 'rss-app-v1';
const ARTICLES_CACHE = 'rss-articles-v1';
const MAX_CACHED_ARTICLES = 25;

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/main.js'
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL_URLS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate: clean up old cache versions
self.addEventListener('activate', (event) => {
  const VALID_CACHES = [APP_CACHE, ARTICLES_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !VALID_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: route requests to appropriate strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // API article endpoints: network-first with cache fallback
  if (url.pathname === '/api/articles' || url.pathname.match(/^\/api\/articles\/[^/]+$/)) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // Other API/LLM endpoints: network-only
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/llm/')) {
    return;
  }

  // App shell and static assets: cache-first
  event.respondWith(cacheFirstWithNetwork(event.request));
});

// Cache-first strategy for app shell
async function cacheFirstWithNetwork(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_CACHE);
      await safeCachePut(cache, request, response.clone());
    }
    return response;
  } catch (error) {
    // If both cache and network fail, return a basic offline page
    if (request.mode === 'navigate') {
      const cache = await caches.open(APP_CACHE);
      const fallback = await cache.match('/index.html');
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
}

// Network-first strategy for article endpoints
async function networkFirstWithCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(ARTICLES_CACHE);
      await safeCachePut(cache, request, response.clone());
      await enforceArticleCacheLimit();
    }
    return response;
  } catch (error) {
    // Network failed, try cache
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Content not available offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Enforce max 25 cached articles by evicting oldest
async function enforceArticleCacheLimit() {
  const cache = await caches.open(ARTICLES_CACHE);
  const keys = await cache.keys();

  // Filter to only individual article requests (not the list endpoint)
  const articleKeys = keys.filter((req) => {
    const url = new URL(req.url);
    return url.pathname.match(/^\/api\/articles\/[^/]+$/);
  });

  if (articleKeys.length > MAX_CACHED_ARTICLES) {
    // Evict oldest entries (earliest in the cache keys list)
    const toEvict = articleKeys.slice(0, articleKeys.length - MAX_CACHED_ARTICLES);
    await Promise.all(toEvict.map((key) => cache.delete(key)));
  }
}

// Safe cache put with quota handling
async function safeCachePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch (error) {
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      // Storage quota exceeded - notify main thread
      notifyClients({
        type: 'CACHE_ERROR',
        payload: {
          error: 'QUOTA_EXCEEDED',
          message: 'Storage quota exceeded. Offline reading may be limited.'
        }
      });
    }
    // Don't rethrow - gracefully skip caching
  }
}

// Online recovery: update cache when back online
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  if (type === 'ONLINE_RECOVERY') {
    // Trigger cache update within 30s
    updateArticleCache();
  }

  if (type === 'CACHE_ARTICLES') {
    cacheArticlesList(payload);
  }

  if (type === 'CLEAR_CACHE') {
    clearAllCaches().then(() => {
      notifyClients({ type: 'CACHE_COMPLETE', payload: { cachedCount: 0 } });
    });
  }

  if (type === 'GET_STATUS') {
    event.source.postMessage({
      type: 'STATUS',
      payload: { isOffline: !self.navigator.onLine }
    });
  }
});

// Update article cache on online recovery (within 30s)
async function updateArticleCache() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch('/api/articles', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const cache = await caches.open(ARTICLES_CACHE);
      await safeCachePut(cache, new Request('/api/articles'), response.clone());

      const data = await response.json();
      const articles = data.articles || data || [];

      // Cache individual articles (up to 25)
      const toCache = articles.slice(0, MAX_CACHED_ARTICLES);
      let cachedCount = 0;

      for (const article of toCache) {
        if (article.id) {
          try {
            const articleController = new AbortController();
            const articleTimeout = setTimeout(() => articleController.abort(), 10000);

            const articleResponse = await fetch(`/api/articles/${article.id}`, {
              signal: articleController.signal
            });
            clearTimeout(articleTimeout);

            if (articleResponse.ok) {
              await safeCachePut(
                cache,
                new Request(`/api/articles/${article.id}`),
                articleResponse.clone()
              );
              cachedCount++;
            }
          } catch (err) {
            // Skip individual article failures
          }
        }
      }

      await enforceArticleCacheLimit();
      notifyClients({
        type: 'CACHE_COMPLETE',
        payload: { cachedCount }
      });
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      notifyClients({
        type: 'CACHE_ERROR',
        payload: { error: 'UPDATE_FAILED', message: 'Failed to update article cache' }
      });
    }
  }
}

// Cache a specific list of articles
async function cacheArticlesList(payload) {
  if (!payload || !payload.articles) return;

  const cache = await caches.open(ARTICLES_CACHE);
  const articles = payload.articles.slice(0, MAX_CACHED_ARTICLES);
  let cachedCount = 0;

  for (const article of articles) {
    if (article.id) {
      try {
        const response = await fetch(`/api/articles/${article.id}`);
        if (response.ok) {
          await safeCachePut(cache, new Request(`/api/articles/${article.id}`), response.clone());
          cachedCount++;
        }
      } catch (err) {
        // Skip failures
      }
    }
  }

  await enforceArticleCacheLimit();
  notifyClients({ type: 'CACHE_COMPLETE', payload: { cachedCount } });
}

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
}

// Post message to all clients
async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage(message);
  });
}
