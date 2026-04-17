/**
 * E2E app interaction tests — runs against the real local API server.
 *
 * Each test seeds an isolated user (unique email + TOTP device) and obtains
 * a JWT token to seed sessionStorage, bypassing the login flow.
 *
 * Run: bun run test:e2e
 */
import { test, expect } from '@playwright/test'
import { uniqueEmail, seedUser, seedDevice, seedDomain, deliverEmail, useTestApi, loginAs, getToken, totpCode } from './helpers.mjs'

// ── Fixture: authenticated page ───────────────────────────────────────────────

async function withAuth(page, opts = {}) {
  const domain = opts.domain ?? `e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.test`
  const email = opts.email ?? `test-${Date.now()}@${domain}`
  const userOpts = { domains: [domain], ...(opts.user ?? {}) }
  await seedUser(email, userOpts)
  const { secret } = await seedDevice(email)
  const data = await getToken(email, secret)
  await useTestApi(page)
  await loginAs(page, data.token, data.email, data.role, data.domains)
  return { email, token: data.token, domains: data.domains }
}

// Navigates to '/' and waits for the app screen to be visible.
async function gotoApp(page) {
  await page.goto('/')
  await expect(page.locator('.app-brand')).toBeVisible()
}

// ── Navigation ────────────────────────────────────────────────────────────────

test('shows app header after login', async ({ page }) => {
  const { email } = await withAuth(page)
  await gotoApp(page)
  await expect(page.locator('.app-user')).toContainText(email)
})

test('shows login screen when not authenticated', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await expect(page.getByText('Sign in')).toBeVisible()
})

test('Sign out returns to login screen', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Sign in')).toBeVisible()
})

// ── Inbox ─────────────────────────────────────────────────────────────────────

test('shows empty inbox message when no emails', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await expect(page.getByText(/No emails/)).toBeVisible()
})

test('401 response logs out and shows login screen', async ({ page }) => {
  await useTestApi(page)
  await page.addInitScript(() => {
    sessionStorage.setItem('hermes_token', 'invalid-token')
    sessionStorage.setItem('hermes_email', 'user@example.com')
    sessionStorage.setItem('hermes_role', 'admin')
    sessionStorage.setItem('hermes_domains', '["example.com"]')
  })
  await page.goto('/')
  await expect(page.getByText('Sign in')).toBeVisible()
})

test('searches inbox messages', async ({ page }) => {
  const { email, token, domains } = await withAuth(page)
  await seedDomain(token, domains[0])
  const key = `playwright-${Date.now()}`
  await deliverEmail({
    recipient: email,
    sender: 'billing@vendor.com',
    subject: `${key} Invoice`,
    body: 'blue searchable body',
    messageId: `${key}-invoice`,
  })
  await deliverEmail({
    recipient: email,
    sender: 'alerts@vendor.com',
    subject: `${key} Alert`,
    body: 'green hidden body',
    messageId: `${key}-alert`,
  })

  await gotoApp(page)
  await expect(page.getByText(`${key} Invoice`)).toBeVisible()
  await page.getByLabel('Search mail').fill('blue searchable')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText(`${key} Invoice`)).toBeVisible()
  await expect(page.getByText(`${key} Alert`)).not.toBeVisible()
})

test('uses mobile bottom navigation at phone widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await withAuth(page)
  await gotoApp(page)

  await expect(page.locator('.sidebar')).toBeHidden()
  const mobileNav = page.locator('.mobile-bottom-nav')
  await expect(mobileNav).toBeVisible()

  await mobileNav.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()

  await mobileNav.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings-panel .settings-section-title').filter({ hasText: 'Notifications' })).toBeVisible()

  await mobileNav.getByRole('button', { name: 'Inbox' }).click()
  await expect(page.getByText(/No emails/)).toBeVisible()
})

// ── Compose ───────────────────────────────────────────────────────────────────

test('shows error when To or Subject is empty', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('To and Subject are required.')).toBeVisible()
})

test('opens compose via C keyboard shortcut', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.keyboard.press('c')
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
})

test('Discard returns to inbox', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByText(/No emails/)).toBeVisible()
})

test('send succeeds and returns to inbox', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Compose' }).click()
  await expect(page.getByPlaceholder('recipient@example.com')).toBeVisible()
  await page.getByPlaceholder('recipient@example.com').fill('bob@example.com')
  await page.getByPlaceholder('Subject').fill('Test email')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(/No emails/)).toBeVisible()
})

// ── Settings ──────────────────────────────────────────────────────────────────

test('navigates to settings', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings-panel .settings-section-title').filter({ hasText: 'Routing Rules' })).toBeVisible()
})

test('MFA devices section shows seeded device', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  const { secret } = await seedDevice(email, 'Work Phone')
  const data = await getToken(email, secret)
  await useTestApi(page)
  await loginAs(page, data.token, data.email, data.role, data.domains)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('Work Phone')).toBeVisible()
})

test('can add a new MFA device from settings', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()

  // Click + Add device
  await page.getByRole('button', { name: '+ Add device' }).click()

  // Wait for the setup form (API call to /mfa/provision completes)
  await expect(page.getByLabel('Secret key')).toBeVisible()

  // Read the generated TOTP secret and compute the current code
  const secret = await page.getByLabel('Secret key').inputValue()
  await page.getByLabel(/Device name/).fill('New Test Device')
  await page.getByLabel('Confirmation code').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Add device' }).click()

  // Device should now appear in the list
  await expect(page.getByText('New Test Device')).toBeVisible()
})

test('shows error for wrong confirmation code when adding device', async ({ page }) => {
  await withAuth(page)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()

  await page.getByRole('button', { name: '+ Add device' }).click()
  await expect(page.getByLabel('Secret key')).toBeVisible()

  await page.getByLabel('Confirmation code').fill('000000')
  await page.getByRole('button', { name: 'Add device' }).click()

  await expect(page.getByText(/Invalid code/)).toBeVisible()
})

test('can remove an MFA device from settings', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  const { secret } = await seedDevice(email, 'Device To Remove')
  const data = await getToken(email, secret)
  await useTestApi(page)
  await loginAs(page, data.token, data.email, data.role, data.domains)
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()

  await expect(page.getByText('Device To Remove')).toBeVisible()

  // Set up dialog accept before clicking Remove
  page.on('dialog', d => d.accept())
  await page.getByRole('button', { name: 'Remove' }).first().click()

  await expect(page.getByText('Device To Remove')).not.toBeVisible()
})
