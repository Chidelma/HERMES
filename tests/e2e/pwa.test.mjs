import { test, expect } from '@playwright/test'

test('exposes installable PWA metadata and registers the service worker', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('head > link[rel="manifest"]')).toHaveAttribute('href', '/assets/manifest.webmanifest')
  await expect(page.locator('head > meta[name="theme-color"]')).toHaveAttribute('content', '#0d0d0d')

  const manifest = await page.request.get('/assets/manifest.webmanifest').then(res => res.json())
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/')
  expect(manifest.icons.some(icon => icon.sizes === '192x192' && icon.type === 'image/png')).toBe(true)
  expect(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(true)

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready
    return {
      scope: ready.scope,
      scriptURL: ready.active?.scriptURL,
      cacheKeys: await caches.keys(),
    }
  })

  expect(registration.scope).toBe('http://localhost:3000/')
  expect(registration.scriptURL).toBe('http://localhost:3000/sw.js')
  expect(registration.cacheKeys).toContain('hermes-pwa-v1')
})
