import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let admin: string
let viewer: string

beforeAll(async () => {
  s = await startTestServer()
  admin  = s.token({ email: 'alice@example.com', domains: ['example.com'], role: 'admin' })
  viewer = s.token({ email: 'bob@example.com',   domains: ['example.com'], role: 'viewer' })
}, 15000)
afterAll(() => s.stop())

// ── GET /domains ───────────────────────────────────────────────────────────────

describe('GET /domains', () => {
  it('returns 401 without token', async () => {
    const r = await s.get('/domains')
    expect(r.status).toBe(401)
  })

  it('returns empty array when no domains', async () => {
    const r = await s.get('/domains', { token: admin })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })
})

// ── POST /domains ──────────────────────────────────────────────────────────────

describe('POST /domains', () => {
  it('returns 401 without token', async () => {
    const r = await s.post('/domains', { domain: 'test.com', routes: [], inboundEnabled: false })
    expect(r.status).toBe(401)
  })

  it('returns 403 for viewer', async () => {
    const r = await s.post('/domains', { domain: 'test.com', routes: [], inboundEnabled: false }, { token: viewer })
    expect(r.status).toBe(403)
  })

  it('returns 400 when domain is missing', async () => {
    const r = await s.post('/domains', {}, { token: admin })
    expect(r.status).toBe(400)
  })

  it('creates a domain', async () => {
    const r = await s.post('/domains', {
      domain: 'example.com',
      routes: [{ id: 'r1', match: '*@example.com', action: { type: 'store' }, enabled: true }],
      inboundEnabled: true,
    }, { token: admin })
    expect(r.status).toBe(200)
    const body = await r.json() as { domain: string }
    expect(body.domain).toBe('example.com')
  })

  it('lists created domain', async () => {
    const r = await s.get('/domains', { token: admin })
    expect(r.status).toBe(200)
    const domains = await r.json() as Array<{ domain: string }>
    expect(domains.some(d => d.domain === 'example.com')).toBe(true)
  })
})

// ── GET /domains/:domain/routes ────────────────────────────────────────────────

describe('GET /domains/:domain/routes', () => {
  it('returns 401 without token', async () => {
    const r = await s.get('/domains/example.com/routes')
    expect(r.status).toBe(401)
  })

  it('returns 403 for domain not in claims', async () => {
    const other = s.token({ email: 'x@other.com', domains: ['other.com'], role: 'admin' })
    const r = await s.get('/domains/example.com/routes', { token: other })
    expect(r.status).toBe(403)
  })

  it('returns routes array', async () => {
    const r = await s.get('/domains/example.com/routes', { token: admin })
    expect(r.status).toBe(200)
    const routes = await r.json() as Array<{ id: string }>
    expect(Array.isArray(routes)).toBe(true)
  })
})

// ── PUT /domains/:domain/routes/:id ────────────────────────────────────────────

describe('PUT /domains/:domain/routes/:id', () => {
  it('returns 401 without token', async () => {
    const r = await s.put('/domains/example.com/routes/r1', {})
    expect(r.status).toBe(401)
  })

  it('upserts a route', async () => {
    const route = { id: 'r2', match: 'admin@example.com', action: { type: 'store' }, enabled: true }
    const r = await s.put('/domains/example.com/routes/r2', route, { token: admin })
    expect(r.status).toBe(200)
    const body = await r.json() as { updated: string }
    expect(body.updated).toBe('r2')
  })
})

// ── DELETE /domains/:domain/routes/:id ────────────────────────────────────────

describe('DELETE /domains/:domain/routes/:id', () => {
  it('deletes a route', async () => {
    const r = await s.delete('/domains/example.com/routes/r2', { token: admin })
    expect(r.status).toBe(200)
    const body = await r.json() as { deleted: string }
    expect(body.deleted).toBe('r2')

    const routes = await (await s.get('/domains/example.com/routes', { token: admin })).json() as Array<{ id: string }>
    expect(routes.some(r => r.id === 'r2')).toBe(false)
  })
})
