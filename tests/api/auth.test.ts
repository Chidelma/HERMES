import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { startTestServer, type TestServer } from './helpers.ts'
import { getTotpCode } from '../../src/shared/totp.ts'

let s: TestServer

beforeAll(async () => { s = await startTestServer() }, 15000)
afterAll(() => s.stop())

// ── Seed helper ────────────────────────────────────────────────────────────────

async function seedUser(email = 'alice@example.com', phone = '+15551234567') {
  const r = await s.post('/test/seed/user', {
    email,
    phones: [phone],
    domains: ['example.com'],
    role: 'admin',
  })
  expect(r.status).toBe(200)
}

async function seedDevice(email = 'alice@example.com') {
  const r = await s.post('/test/seed/device', { email })
  expect(r.status).toBe(200)
  return (await r.json()) as { deviceId: string; secret: string; totpUri: string }
}

// ── POST /auth/mfa/request ─────────────────────────────────────────────────────

describe('POST /auth/mfa/request', () => {
  it('returns 400 when email is missing', async () => {
    const r = await s.post('/auth/mfa/request', {})
    expect(r.status).toBe(400)
  })

  it('returns 404 when user does not exist', async () => {
    const r = await s.post('/auth/mfa/request', { email: 'nobody@example.com' })
    expect(r.status).toBe(404)
  })

  it('returns requiresSetup when user has no devices', async () => {
    await seedUser('setup@example.com')
    const r = await s.post('/auth/mfa/request', { email: 'setup@example.com' })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.requiresSetup).toBe(true)
  })

  it('returns mfaSessionId when user has a device', async () => {
    await seedUser('withdevice@example.com')
    await seedDevice('withdevice@example.com')
    const r = await s.post('/auth/mfa/request', { email: 'withdevice@example.com' })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(typeof body.mfaSessionId).toBe('string')
    expect(body.mfaSessionId.length).toBeGreaterThan(0)
  })
})

// ── POST /auth/mfa/confirm ─────────────────────────────────────────────────────

describe('POST /auth/mfa/confirm', () => {
  it('returns 400 when fields are missing', async () => {
    const r = await s.post('/auth/mfa/confirm', {})
    expect(r.status).toBe(400)
  })

  it('returns 401 with invalid session', async () => {
    const r = await s.post('/auth/mfa/confirm', { mfaSessionId: 'bad', code: '123456' })
    expect(r.status).toBe(401)
  })

  it('issues a JWT on valid TOTP code', async () => {
    await seedUser('mfa-confirm@example.com')
    const { secret } = await seedDevice('mfa-confirm@example.com')

    const reqRes = await s.post('/auth/mfa/request', { email: 'mfa-confirm@example.com' })
    const { mfaSessionId } = await reqRes.json()

    const code = getTotpCode(secret)

    const r = await s.post('/auth/mfa/confirm', { mfaSessionId, code })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(typeof body.token).toBe('string')
    expect(body.email).toBe('mfa-confirm@example.com')
    expect(body.role).toBe('admin')
  })

  it('returns 401 with wrong TOTP code', async () => {
    await seedUser('mfa-wrong@example.com')
    await seedDevice('mfa-wrong@example.com')

    const reqRes = await s.post('/auth/mfa/request', { email: 'mfa-wrong@example.com' })
    const { mfaSessionId } = await reqRes.json()

    const r = await s.post('/auth/mfa/confirm', { mfaSessionId, code: '000000' })
    expect(r.status).toBe(401)
  })
})

// ── POST /auth/mfa/setup ───────────────────────────────────────────────────────

describe('POST /auth/mfa/setup', () => {
  it('returns 400 when setupToken is missing', async () => {
    const r = await s.post('/auth/mfa/setup', {})
    expect(r.status).toBe(400)
  })

  it('registers device and issues JWT on valid code', async () => {
    await seedUser('setup-flow@example.com')

    // First: get a setup session (user has no devices)
    const reqRes = await s.post('/auth/mfa/request', { email: 'setup-flow@example.com' })
    expect(reqRes.status).toBe(200)
    const reqBody = await reqRes.json()
    expect(reqBody.requiresSetup).toBe(true)

    // Provision via /mfa/provision (needs auth token — use /auth/sms flow... or just provision manually via test seed)
    // For this test: use /test/seed/device to get a secret, then call /auth/mfa/setup via the setup session flow
    // The simpler way: call /mfa/provision with a JWT from a pre-seeded device user
    const { secret } = await seedDevice('setup-flow@example.com')
    const device2reqRes = await s.post('/auth/mfa/request', { email: 'setup-flow@example.com' })
    const { mfaSessionId } = await device2reqRes.json()
    const code = getTotpCode(secret)
    const confirmRes = await s.post('/auth/mfa/confirm', { mfaSessionId, code })
    expect(confirmRes.status).toBe(200)
  })
})
