/**
 * E2E login flow tests — runs against the real local API server.
 *
 * Each test seeds its own isolated user (unique email) so tests are
 * fully stateless and safe to run in parallel.
 *
 * Run: bun run test:e2e
 */
import { test, expect } from '@playwright/test'
import { uniqueEmail, seedUser, seedDevice, seedOtp, useTestApi, totpCode } from './helpers.mjs'

// ── Start step ────────────────────────────────────────────────────────────────

test('shows email input on load', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await expect(page.getByText('Sign in')).toBeVisible()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
})

test('shows error for unknown email', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('nobody@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/No account found/)).toBeVisible()
})

test('shows error when email field is empty', async ({ page }) => {
  await useTestApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Email is required.')).toBeVisible()
})

// ── TOTP step (registered user with a device) ─────────────────────────────────

test('shows TOTP step for user with a registered device', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  await seedDevice(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Authenticator code')).toBeVisible()
})

test('logs in with a valid TOTP code', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  const { secret } = await seedDevice(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('000000').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page).toHaveURL('/inbox')
})

test('shows error for wrong TOTP code', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  await seedDevice(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('000000').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByText(/Invalid code/)).toBeVisible()
})

test('validates TOTP field length before submitting', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  await seedDevice(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('000000').fill('123')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByText('Enter the 6-digit code from your authenticator.')).toBeVisible()
})

test('Back from TOTP returns to email step', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  await seedDevice(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Authenticator code')).toBeVisible()
  await page.getByRole('button', { name: '← Back' }).click()
  await expect(page.getByText('Sign in')).toBeVisible()
})

// ── Phone-input step (no device registered yet) ───────────────────────────────

test('shows phone-input step for user with no device', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)  // no device seeded

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Phone verification')).toBeVisible()
})

test('"Use phone backup" from TOTP step goes to phone-input', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  await seedDevice(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Use phone backup' }).click()
  await expect(page.getByText('Phone verification')).toBeVisible()
})

test('does not reveal whether a phone is linked to an account', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)  // default phone: +14165550100

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+19995550000')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('Enter your code')).toBeVisible()
})

test('sends SMS and shows phone-code step', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByText('Enter your code')).toBeVisible()
})

// ── Phone-code step ───────────────────────────────────────────────────────────

test('advances to mfa-setup after correct SMS code (no device)', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  const { sessionId, code } = await seedOtp(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText('Set up authenticator')).toBeVisible()
})

test('logs in after correct SMS code (user has existing device)', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  await seedDevice(email)
  const { code } = await seedOtp(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Use phone backup' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page).toHaveURL('/inbox')
})

test('shows error for wrong SMS code', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  await seedOtp(email)  // creates session but we won't use the correct code

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(/Invalid code/)).toBeVisible()
})

// ── MFA setup step ────────────────────────────────────────────────────────────

test('activates first authenticator and logs in', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  const { code } = await seedOtp(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()

  // On mfa-setup — the secret is shown; we read it from the input to compute the code
  const secret = await page.getByLabel('Secret key').inputValue()
  await page.getByLabel(/Device name/).fill('My iPhone')
  await page.getByLabel('Confirmation code').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Activate' }).click()

  await expect(page).toHaveURL('/inbox')
})

test('shows error for wrong activation code on setup', async ({ page }) => {
  const email = uniqueEmail()
  await seedUser(email)
  const { code } = await seedOtp(email)

  await useTestApi(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.getByLabel('Confirmation code').fill('000000')
  await page.getByRole('button', { name: 'Activate' }).click()

  await expect(page.getByText(/Invalid code/)).toBeVisible()
})
