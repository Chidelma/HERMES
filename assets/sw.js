const CACHE_VERSION = 'hermes-pwa-v1'
const APP_SHELL = [
  '/',
  '/index.html',
  '/main.js',
  '/spa-renderer.js',
  '/routes.json',
  '/layouts.json',
  '/assets/styles.css',
  '/assets/config.js',
  '/assets/favicon.svg',
  '/assets/manifest.webmanifest',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/maskable-icon-512.png',
]

const STATIC_EXTENSIONS = /\.(?:css|js|json|svg|png|webp|ico|woff2?)$/i

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'))
    return
  }

  if (url.pathname === '/assets/config.js') {
    event.respondWith(networkFirst(request))
    return
  }

  if (APP_SHELL.includes(url.pathname) || STATIC_EXTENSIONS.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})

self.addEventListener('push', event => {
  const message = readPushMessage(event)
  const title = message.title || 'New email'
  const body = message.body || 'You have new mail.'
  const url = message.url || '/inbox'
  const tag = message.emailId ? `email-${message.emailId}` : 'hermes-email'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: '/assets/icon-192.png',
      badge: '/assets/maskable-icon-512.png',
      data: {
        url,
        emailId: message.emailId || '',
      },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/inbox', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client && new URL(client.url).origin === self.location.origin) {
        await client.focus()
        if ('navigate' in client && client.url !== targetUrl) await client.navigate(targetUrl)
        return
      }
    }

    if (self.clients.openWindow) await self.clients.openWindow(targetUrl)
  })())
})

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_VERSION)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return (await cache.match(request)) || (fallbackPath ? await cache.match(fallbackPath) : undefined) || Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(request)
  const fresh = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)

  return cached || await fresh || Response.error()
}

function readPushMessage(event) {
  if (!event.data) return {}
  try {
    return event.data.json()
  } catch {
    return { body: event.data.text() }
  }
}
