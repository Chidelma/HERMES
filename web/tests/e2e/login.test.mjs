/**
 * E2E tests for the login flow.
 *
 * All API calls are intercepted via page.route() so no real backend is needed.
 * Run: bun run test:e2e
 */
import { test, expect } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockMfaRequest(page, response) {
  return page.route('**/auth/mfa/request', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  )
}

function mockMfaConfirm(page, response, status = 200) {
  return page.route('**/auth/mfa/confirm', route =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) })
  )
}

function mockSmsRequest(page, response, status = 200) {
  return page.route('**/auth/sms/request', route =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) })
  )
}

function mockSmsConfirm(page, response, status = 200) {
  return page.route('**/auth/sms/confirm', route =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) })
  )
}

function mockMfaSetup(page, response, status = 200) {
  return page.route('**/auth/mfa/setup', route =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) })
  )
}

const LOGIN_RESPONSE = {
  token: 'test-jwt-token',
  email: 'admin@example.com',
  role: 'admin',
  domains: ['example.com'],
}

// ── Start step ────────────────────────────────────────────────────────────────

test('shows email input on load', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Sign in')).toBeVisible()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
})

test('shows error when email is empty and Continue clicked', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Email is required.')).toBeVisible()
})

// ── MFA step (user has a device registered) ───────────────────────────────────

test('shows TOTP step when user has MFA registered', async ({ page }) => {
  await mockMfaRequest(page, { mfaSessionId: 'sess_abc' })
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('admin@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Authenticator code')).toBeVisible()
  await expect(page.getByPlaceholder('000000')).toBeVisible()
})

test('verifies TOTP and dispatches login event', async ({ page }) => {
  await mockMfaRequest(page, { mfaSessionId: 'sess_abc' })
  await mockMfaConfirm(page, LOGIN_RESPONSE)

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('admin@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('000000').fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()

  // After login the app navigates to /inbox
  await expect(page).toHaveURL('/inbox')
})

test('shows error on wrong TOTP code', async ({ page }) => {
  await mockMfaRequest(page, { mfaSessionId: 'sess_abc' })
  await mockMfaConfirm(page, { error: 'Invalid code.' }, 401)

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('admin@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('000000').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByText('Invalid code.')).toBeVisible()
})

test('validates TOTP field — must be 6 digits before submit', async ({ page }) => {
  await mockMfaRequest(page, { mfaSessionId: 'sess_abc' })

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('admin@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('000000').fill('123')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByText('Enter the 6-digit code from your authenticator.')).toBeVisible()
})

test('Back button returns to email step from MFA step', async ({ page }) => {
  await mockMfaRequest(page, { mfaSessionId: 'sess_abc' })

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('admin@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: '← Back' }).click()

  await expect(page.getByText('Sign in')).toBeVisible()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
})

// ── Phone backup path ─────────────────────────────────────────────────────────

test('"Use phone backup" transitions to phone-input step', async ({ page }) => {
  await mockMfaRequest(page, { mfaSessionId: 'sess_abc' })

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('admin@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Use phone backup' }).click()

  await expect(page.getByText('Phone verification')).toBeVisible()
  await expect(page.getByPlaceholder('+1 416 555 0100')).toBeVisible()
})

// ── Phone input step (first-time setup or backup) ─────────────────────────────

test('shows phone-input step when user has no MFA device', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Phone verification')).toBeVisible()
})

test('shows error when phone is empty and Send code clicked', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Send code' }).click()

  await expect(page.getByText('Phone number is required.')).toBeVisible()
})

test('sends SMS and shows phone-code step', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })
  await mockSmsRequest(page, { sessionId: 'otp_xyz' })

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()

  await expect(page.getByText('Enter your code')).toBeVisible()
  await expect(page.getByText('We sent a 6-digit code to your phone.')).toBeVisible()
})

test('shows error on SMS request failure', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })
  await mockSmsRequest(page, { error: 'Phone not found.' }, 404)

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()

  await expect(page.getByText('Phone not found.')).toBeVisible()
})

// ── Phone code step ───────────────────────────────────────────────────────────

test('confirms SMS OTP and logs in (user already has MFA device)', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })
  await mockSmsRequest(page, { sessionId: 'otp_xyz' })
  await mockSmsConfirm(page, LOGIN_RESPONSE)

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('654321')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page).toHaveURL('/inbox')
})

test('confirms SMS OTP and advances to mfa-setup (first-time user)', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })
  await mockSmsRequest(page, { sessionId: 'otp_xyz' })
  await mockSmsConfirm(page, {
    requiresSetup: true,
    setupToken: 'setup_tok',
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpUri: 'otpauth://totp/HERMES:new@example.com?secret=JBSWY3DPEHPK3PXP&issuer=HERMES',
  })

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('654321')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByText('Set up authenticator')).toBeVisible()
  await expect(page.getByDisplayValue('JBSWY3DPEHPK3PXP')).toBeVisible()
})

// ── MFA setup step ────────────────────────────────────────────────────────────

test('activates authenticator and logs in', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })
  await mockSmsRequest(page, { sessionId: 'otp_xyz' })
  await mockSmsConfirm(page, {
    requiresSetup: true,
    setupToken: 'setup_tok',
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpUri: 'otpauth://totp/HERMES:new@example.com?secret=JBSWY3DPEHPK3PXP&issuer=HERMES',
  })
  await mockMfaSetup(page, LOGIN_RESPONSE)

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('654321')
  await page.getByRole('button', { name: 'Verify' }).click()

  // Now on mfa-setup step
  await page.getByLabel(/Device name/).fill('My iPhone')
  await page.getByLabel('Confirmation code').fill('112233')
  await page.getByRole('button', { name: 'Activate' }).click()

  await expect(page).toHaveURL('/inbox')
})

test('shows error on invalid setup code', async ({ page }) => {
  await mockMfaRequest(page, { requiresSetup: true })
  await mockSmsRequest(page, { sessionId: 'otp_xyz' })
  await mockSmsConfirm(page, {
    requiresSetup: true,
    setupToken: 'setup_tok',
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpUri: 'otpauth://totp/HERMES:new@example.com?secret=JBSWY3DPEHPK3PXP&issuer=HERMES',
  })
  await mockMfaSetup(page, { error: 'Invalid code — make sure your device clock is correct.' }, 400)

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('new@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('654321')
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.getByLabel('Confirmation code').fill('000000')
  await page.getByRole('button', { name: 'Activate' }).click()

  await expect(page.getByText('Invalid code — make sure your device clock is correct.')).toBeVisible()
})
