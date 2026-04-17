// Shared head-level setup — runs on every page in this app.
// Add global analytics, meta configuration, or shared utilities here.

document.documentElement.lang = 'en'

if ('serviceWorker' in navigator && !window.__HERMES_DISABLE_SW) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA support should never block the mail UI.
    })
  })
}
