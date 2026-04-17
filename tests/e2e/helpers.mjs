/**
 * Shared helpers for Playwright E2E tests.
 * Handles: TOTP code generation, test server seeding, and page setup.
 */
import { createHmac } from 'node:crypto'

export const API = 'http://localhost:9876'

// ── TOTP (RFC 6238) ───────────────────────────────────────────────────────────

function base32Decode(str) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const s = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes = []
  let bits = 0, val = 0
  for (const ch of s) {
    const idx = ALPHA.indexOf(ch)
    if (idx < 0) continue
    val = (val << 5) | idx
    bits += 5
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(bytes)
}

/** Returns the current 6-digit TOTP code for the given base32 secret. */
export function totpCode(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30)
  const key = base32Decode(secret)
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  msg.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac('sha1', key).update(msg).digest()
  const offset = hmac[19] & 0xf
  const code = (
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8)  |
     (hmac[offset + 3] & 0xff)
  ) % 1_000_000
  return String(code).padStart(6, '0')
}

// ── Unique test email ─────────────────────────────────────────────────────────

let _counter = 0

/** Returns a unique email address for each call — keeps tests independent. */
export function uniqueEmail() {
  return `test-${Date.now()}-${++_counter}@example.com`
}

// ── Test server seed helpers ──────────────────────────────────────────────────

async function post(path, data) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Seed ${path} failed: ${await res.text()}`)
  return res.json()
}

/**
 * Creates a user in the test backend.
 * @param {string} email
 * @param {{ phones?: string[], domains?: string[], role?: string }} opts
 */
export async function seedUser(email, { phones = ['+14165550100'], domains = ['example.com'], role = 'admin' } = {}) {
  await post('/test/seed/user', { email, phones, domains, role })
}

/**
 * Creates a TOTP device for a user. Returns the device secret so the
 * test can generate valid codes with totpCode(secret).
 * @param {string} email
 * @param {string} [name]
 * @returns {Promise<{ deviceId: string, secret: string }>}
 */
export async function seedDevice(email, name = 'Test Device') {
  return post('/test/seed/device', { email, name })
}

/**
 * Creates an OTP session with a known code (no SMS sent).
 * Returns { sessionId, code } so the test can submit the correct code.
 * @param {string} email
 * @param {string} [phone]
 * @returns {Promise<{ sessionId: string, code: string }>}
 */
export async function seedOtp(email, phone = '+14165550100') {
  return post('/test/seed/otp', { email, phone })
}

export async function seedDomain(token, domain = 'example.com') {
  const res = await fetch(`${API}/domains`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      domain,
      routes: [{ id: `route-${Date.now()}`, match: `*@${domain}`, action: { type: 'store' }, enabled: true }],
      inboundEnabled: true,
    }),
  })
  if (!res.ok) throw new Error(`Seed domain failed: ${await res.text()}`)
  return res.json()
}

export async function deliverEmail({ recipient, sender = 'sender@other.com', subject, body = '', messageId }) {
  return post('/inbound/webhook', { recipient, sender, subject, body, messageId })
}

// ── Page setup ────────────────────────────────────────────────────────────────

/**
 * Intercepts /assets/config.js to point the app at the local test server.
 * Must be called before page.goto().
 */
export async function useTestApi(page) {
  await page.addInitScript(() => {
    window.__HERMES_DISABLE_SW = true
  })
  await page.route('**/assets/config.js', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.HERMES_CONFIG={apiUrl:"${API}"};`,
    })
  )
}

/**
 * Seeds sessionStorage to simulate a logged-in user, bypassing the login flow.
 * Must be called before page.goto().
 */
export async function loginAs(page, token, email, role = 'admin', domains = ['example.com']) {
  await page.addInitScript(({ token, email, role, domains }) => {
    sessionStorage.setItem('hermes_token', token)
    sessionStorage.setItem('hermes_email', email)
    sessionStorage.setItem('hermes_role', role)
    sessionStorage.setItem('hermes_domains', JSON.stringify(domains))
  }, { token, email, role, domains })
}

/**
 * Gets a JWT for a user by performing the TOTP login flow programmatically.
 * Requires the user and a TOTP device to already be seeded.
 */
export async function getToken(email, totpSecret) {
  // Request MFA session
  const r1 = await fetch(`${API}/auth/mfa/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const { mfaSessionId } = await r1.json()

  // Confirm TOTP
  const r2 = await fetch(`${API}/auth/mfa/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaSessionId, code: totpCode(totpSecret) }),
  })
  const data = await r2.json()
  if (!data.token) throw new Error(`getToken failed: ${JSON.stringify(data)}`)
  return data
}
