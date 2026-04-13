/**
 * E2E tests for the main app (inbox, compose, settings, navigation).
 *
 * Each test pre-seeds sessionStorage to simulate a logged-in user,
 * bypassing the login flow. API calls are intercepted via page.route().
 * Run: bun run test:e2e
 */
import { test, expect } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(page, { email = 'admin@example.com', role = 'admin', domains = ['example.com'] } = {}) {
  await page.addInitScript(({ email, role, domains }) => {
    sessionStorage.setItem('hermes_token', 'test-jwt')
    sessionStorage.setItem('hermes_email', email)
    sessionStorage.setItem('hermes_role', role)
    sessionStorage.setItem('hermes_domains', JSON.stringify(domains))
  }, { email, role, domains })
}

const EMAILS = [
  {
    id: 'e1',
    sender: 'alice@example.com',
    subject: 'Hello there',
    text: 'Hi, how are you?',
    date: new Date().toISOString(),
    folder: 'inbox',
  },
  {
    id: 'e2',
    sender: 'bob@example.com',
    subject: 'Project update',
    text: 'See attached.',
    date: new Date().toISOString(),
    folder: 'inbox',
  },
]

// ── Navigation ────────────────────────────────────────────────────────────────

test('redirects to /inbox after login', async ({ page }) => {
  await loginAs(page)
  await page.goto('/inbox')
  await expect(page.getByText('HERMES')).toBeVisible()
  await expect(page.getByText('admin@example.com')).toBeVisible()
})

test('shows login screen when not authenticated', async ({ page }) => {
  await page.goto('/inbox')
  await expect(page.getByText('Sign in')).toBeVisible()
})

test('Sign out returns to login screen', async ({ page }) => {
  await loginAs(page)
  await page.goto('/inbox')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Sign in')).toBeVisible()
})

// ── Inbox ─────────────────────────────────────────────────────────────────────

test('loads and displays emails', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMAILS) })
  )
  await page.goto('/inbox')
  await expect(page.getByText('alice@example.com')).toBeVisible()
  await expect(page.getByText('bob@example.com')).toBeVisible()
  await expect(page.getByText('Hello there')).toBeVisible()
  await expect(page.getByText('Project update')).toBeVisible()
})

test('shows empty state when inbox has no emails', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.goto('/inbox')
  await expect(page.getByText('No emails')).toBeVisible()
})

test('Refresh button re-fetches inbox', async ({ page }) => {
  let calls = 0
  await loginAs(page)
  await page.route('**/inbox', route => {
    calls++
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.goto('/inbox')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => calls).toBeGreaterThanOrEqual(2)
})

test('opens email detail on row click', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMAILS) })
  )
  await page.goto('/inbox')
  await page.getByText('Hello there').click()
  await expect(page.getByText('Hi, how are you?')).toBeVisible()
})

// ── Compose ───────────────────────────────────────────────────────────────────

test('opens compose view from C keyboard shortcut', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.goto('/inbox')
  await page.keyboard.press('c')
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
})

test('shows error when To or Subject is empty on send', async ({ page }) => {
  await loginAs(page)
  await page.goto('/compose')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('To and Subject are required.')).toBeVisible()
})

test('sends email and returns to inbox', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/send', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  )
  await page.goto('/compose')
  await page.getByPlaceholder('recipient@example.com').fill('bob@example.com')
  await page.getByPlaceholder('Subject').fill('Test email')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page).toHaveURL('/inbox')
})

test('Discard returns to inbox without sending', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.goto('/compose')
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page).toHaveURL('/inbox')
})

// ── Settings ──────────────────────────────────────────────────────────────────

test('navigates to settings view', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/users**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/mfa/devices**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.goto('/settings')
  await expect(page.getByText('Settings')).toBeVisible()
})

test('shows MFA devices list', async ({ page }) => {
  await loginAs(page)
  await page.route('**/users**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('**/mfa/devices**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'd1', name: 'iPhone 15', createdAt: new Date().toISOString() },
      ]),
    })
  )
  await page.goto('/settings')
  await expect(page.getByText('iPhone 15')).toBeVisible()
})

test('401 response clears session and shows login', async ({ page }) => {
  await loginAs(page)
  await page.route('**/inbox', route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) })
  )
  await page.goto('/inbox')
  await expect(page.getByText('Sign in')).toBeVisible()
})
