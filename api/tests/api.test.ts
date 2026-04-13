/**
 * Integration tests for the HERMES API.
 *
 * Run with:  bun test tests/api.test.ts
 *
 * Requires AWS credentials with access to Secrets Manager (hermes/api-key).
 * Tests mint JWTs locally against the real secret — no SMS is sent.
 * The only auth/request calls made are ones that never reach SNS (bad credentials).
 */
import { describe, test, expect, beforeAll } from 'bun:test'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { signJwt } from '../src/shared/jwt'

// ── Config ────────────────────────────────────────────────────────────────────

const API = process.env.API_URL?.replace(/\/$/, '')
  ?? 'https://v5qp86a33m.execute-api.us-east-1.amazonaws.com/v1'

const DOMAIN = 'gokeinvestmentcorp.com'
const ADMIN_EMAIL = 'admin@gokeinvestmentcorp.com'
const REGION = 'us-east-1'

// ── Helpers ───────────────────────────────────────────────────────────────────

let adminToken: string
let viewerToken: string

async function get(path: string, token?: string) {
  return fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function post(path: string, body: unknown, token?: string) {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function del(path: string, token?: string) {
  return fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function options(path: string) {
  return fetch(`${API}${path}`, { method: 'OPTIONS' })
}

async function json(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const sm = new SecretsManagerClient({ region: REGION })
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: 'hermes/api-key' })
  )
  if (!SecretString) throw new Error('hermes/api-key secret is empty')

  adminToken = signJwt(
    { email: ADMIN_EMAIL, domains: [DOMAIN], role: 'admin' },
    SecretString
  )
  viewerToken = signJwt(
    { email: `viewer@${DOMAIN}`, domains: [DOMAIN], role: 'viewer' },
    SecretString
  )
})

// ── CORS preflights ───────────────────────────────────────────────────────────

describe('CORS', () => {
  test('OPTIONS /inbox returns 200 with CORS headers', async () => {
    const res = await options('/inbox')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
  })

  test('OPTIONS /auth/sms/request returns 200 with CORS headers', async () => {
    const res = await options('/auth/sms/request')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

// ── Auth: POST /auth/sms/request ─────────────────────────────────────────────

describe('POST /auth/sms/request', () => {
  test('missing body → 400', async () => {
    const res = await fetch(`${API}/auth/sms/request`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  test('missing email → 400', async () => {
    const res = await post('/auth/sms/request', { phone: '+15483906233' })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toBeTruthy()
  })

  test('missing phone → 400', async () => {
    const res = await post('/auth/sms/request', { email: ADMIN_EMAIL })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toBeTruthy()
  })

  test('unknown credentials → 404', async () => {
    const res = await post('/auth/sms/request', {
      email: 'nobody@example.com',
      phone: '+10000000000',
    })
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error).toBeTruthy()
  })

  test('invalid JSON → 400', async () => {
    const res = await fetch(`${API}/auth/sms/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })
})

// ── Auth: POST /auth/sms/confirm ──────────────────────────────────────────────

describe('POST /auth/sms/confirm', () => {
  test('missing body → 400', async () => {
    const res = await fetch(`${API}/auth/sms/confirm`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  test('missing code → 400', async () => {
    const res = await post('/auth/sms/confirm', { sessionId: 'abc' })
    expect(res.status).toBe(400)
  })

  test('missing sessionId → 400', async () => {
    const res = await post('/auth/sms/confirm', { code: '123456' })
    expect(res.status).toBe(400)
  })

  test('nonexistent session → 401', async () => {
    const res = await post('/auth/sms/confirm', {
      sessionId: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      code: '000000',
    })
    expect(res.status).toBe(401)
  })
})

// ── Auth: POST /auth/mfa/request ──────────────────────────────────────────────

describe('POST /auth/mfa/request', () => {
  test('missing body → 400', async () => {
    const res = await fetch(`${API}/auth/mfa/request`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  test('missing email → 400', async () => {
    const res = await post('/auth/mfa/request', {})
    expect(res.status).toBe(400)
  })

  test('unknown email → 404', async () => {
    const res = await post('/auth/mfa/request', { email: 'nobody@example.com' })
    expect(res.status).toBe(404)
  })
})

// ── Auth: POST /auth/mfa/confirm ──────────────────────────────────────────────

describe('POST /auth/mfa/confirm', () => {
  test('missing body → 400', async () => {
    const res = await fetch(`${API}/auth/mfa/confirm`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  test('nonexistent session → 401', async () => {
    const res = await post('/auth/mfa/confirm', {
      mfaSessionId: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      code: '000000',
    })
    expect(res.status).toBe(401)
  })
})

// ── Auth: POST /auth/mfa/setup ────────────────────────────────────────────────

describe('POST /auth/mfa/setup', () => {
  test('missing body → 400', async () => {
    const res = await fetch(`${API}/auth/mfa/setup`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  test('invalid setup token → 401', async () => {
    const res = await post('/auth/mfa/setup', {
      setupToken: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      code: '000000',
    })
    expect(res.status).toBe(401)
  })
})

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('Auth guard', () => {
  test('no token → 401', async () => {
    const res = await get('/inbox')
    expect(res.status).toBe(401)
  })

  test('malformed token → 401', async () => {
    const res = await get('/inbox', 'not.a.token')
    expect(res.status).toBe(401)
  })

  test('tampered signature → 401', async () => {
    const [h, p] = adminToken.split('.')
    const res = await get('/inbox', `${h}.${p}.invalidsignature`)
    expect(res.status).toBe(401)
  })

  test('expired token → 401', async () => {
    const sm = new SecretsManagerClient({ region: REGION })
    const { SecretString } = await sm.send(
      new GetSecretValueCommand({ SecretId: 'hermes/api-key' })
    )
    const expiredToken = signJwt(
      { email: ADMIN_EMAIL, domains: [DOMAIN], role: 'admin' },
      SecretString!,
      -1 // already expired
    )
    const res = await get('/inbox', expiredToken)
    expect(res.status).toBe(401)
  })
})

// ── Inbox ─────────────────────────────────────────────────────────────────────

describe('GET /inbox', () => {
  test('returns array for admin', async () => {
    const res = await get('/inbox', adminToken)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body)).toBe(true)
  })

  test('returns array for viewer', async () => {
    const res = await get('/inbox', viewerToken)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body)).toBe(true)
  })

  test('each item has expected shape', async () => {
    const res = await get('/inbox', adminToken)
    const emails = await json(res) as any[]
    for (const e of emails) {
      expect(typeof e.id).toBe('string')
      expect(typeof e.sender).toBe('string')
      expect(typeof e.subject).toBe('string')
      expect(typeof e.receivedAt).toBe('string')
      expect(typeof e.domain).toBe('string')
    }
  })
})

describe('GET /inbox/:id', () => {
  test('nonexistent id → 404', async () => {
    const res = await get('/inbox/nonexistent-id-12345', adminToken)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /inbox/:id', () => {
  test('nonexistent id → 404', async () => {
    const res = await del('/inbox/nonexistent-id-12345', adminToken)
    expect(res.status).toBe(404)
  })
})

// ── Domains ───────────────────────────────────────────────────────────────────

describe('GET /domains', () => {
  test('returns array for admin', async () => {
    const res = await get('/domains', adminToken)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body)).toBe(true)
  })

  test('returns array for viewer', async () => {
    const res = await get('/domains', viewerToken)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body)).toBe(true)
  })

  test('each item has expected shape', async () => {
    const res = await get('/domains', adminToken)
    const domains = await json(res) as any[]
    for (const d of domains) {
      expect(typeof d.domain).toBe('string')
      expect(Array.isArray(d.routes)).toBe(true)
    }
  })
})

describe('POST /domains', () => {
  test('viewer → 403', async () => {
    const res = await post('/domains', { domain: 'test.com', routes: [], inboundEnabled: false }, viewerToken)
    expect(res.status).toBe(403)
  })

  test('missing body → 400', async () => {
    const res = await fetch(`${API}/domains`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /domains/:domain/routes', () => {
  test('domain not in user domains → 403', async () => {
    const res = await get('/domains/notmydomain.com/routes', adminToken)
    expect(res.status).toBe(403)
  })

  test('unknown domain in user domains → 404', async () => {
    // Use a token for a domain the user claims but doesn't exist in Fylo
    const sm = new SecretsManagerClient({ region: REGION })
    const { SecretString } = await sm.send(
      new GetSecretValueCommand({ SecretId: 'hermes/api-key' })
    )
    const ghostToken = signJwt(
      { email: 'test@ghost.example', domains: ['ghost.example'], role: 'admin' },
      SecretString!
    )
    const res = await get('/domains/ghost.example/routes', ghostToken)
    expect(res.status).toBe(404)
  })
})

// ── Users (admin only) ────────────────────────────────────────────────────────

describe('GET /users', () => {
  test('admin → 200 with array', async () => {
    const res = await get('/users', adminToken)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body)).toBe(true)
  })

  test('viewer → 403', async () => {
    const res = await get('/users', viewerToken)
    expect(res.status).toBe(403)
  })

  test('each user has expected shape', async () => {
    const res = await get('/users', adminToken)
    const users = await json(res) as any[]
    for (const u of users) {
      expect(typeof u.id).toBe('string')
      expect(typeof u.email).toBe('string')
      expect(Array.isArray(u.domains)).toBe(true)
      expect(['admin', 'viewer']).toContain(u.role)
    }
  })

  test('seeded admin user is present', async () => {
    const res = await get('/users', adminToken)
    const users = await json(res) as any[]
    const admin = users.find((u: any) => u.email === ADMIN_EMAIL)
    expect(admin).toBeDefined()
    expect(admin.role).toBe('admin')
    expect(admin.domains).toContain(DOMAIN)
  })
})

describe('POST /users', () => {
  test('viewer → 403', async () => {
    const res = await post('/users', { email: 'x@x.com', phone: '+1111', domains: [DOMAIN], role: 'viewer' }, viewerToken)
    expect(res.status).toBe(403)
  })

  test('missing email → 400', async () => {
    const res = await post('/users', { phone: '+1111', domains: [DOMAIN], role: 'viewer' }, adminToken)
    expect(res.status).toBe(400)
  })

  test('missing phone → 400', async () => {
    const res = await post('/users', { email: 'x@x.com', domains: [DOMAIN], role: 'viewer' }, adminToken)
    expect(res.status).toBe(400)
  })

  test('missing domains → 400', async () => {
    const res = await post('/users', { email: 'x@x.com', phone: '+1111', role: 'viewer' }, adminToken)
    expect(res.status).toBe(400)
  })

  test('empty domains → 400', async () => {
    const res = await post('/users', { email: 'x@x.com', phone: '+1111', domains: [], role: 'viewer' }, adminToken)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /users/:id', () => {
  test('viewer → 403', async () => {
    const res = await del('/users/some-id', viewerToken)
    expect(res.status).toBe(403)
  })
})

// ── Suppressed ────────────────────────────────────────────────────────────────

describe('GET /suppressed', () => {
  test('admin → 200 with array', async () => {
    const res = await get('/suppressed', adminToken)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body)).toBe(true)
  })

  test('viewer → 403', async () => {
    const res = await get('/suppressed', viewerToken)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /suppressed/:address', () => {
  test('viewer → 403', async () => {
    const res = await del('/suppressed/test%40example.com', viewerToken)
    expect(res.status).toBe(403)
  })

  test('nonexistent address → 200 (idempotent)', async () => {
    const res = await del('/suppressed/nobody%40nowhere.example', adminToken)
    expect(res.status).toBe(200)
  })
})

// ── Send ──────────────────────────────────────────────────────────────────────

describe('POST /send', () => {
  test('no auth → 401', async () => {
    const res = await fetch(`${API}/send`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  test('missing body → 400', async () => {
    const res = await fetch(`${API}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(400)
  })

  test('invalid JSON → 400', async () => {
    const res = await fetch(`${API}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: '{bad json',
    })
    expect(res.status).toBe(400)
  })
})

// ── 404 catch-all ─────────────────────────────────────────────────────────────

describe('Unknown routes', () => {
  test('GET /nonexistent → 401 (auth checked first)', async () => {
    const res = await get('/nonexistent-route')
    expect(res.status).toBe(401)
  })

  test('GET /nonexistent with valid token → 404', async () => {
    const res = await get('/nonexistent-route', adminToken)
    expect(res.status).toBe(404)
  })
})
