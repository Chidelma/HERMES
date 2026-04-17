import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let admin: string

beforeAll(async () => {
  s = await startTestServer()
  admin = s.token({ email: 'admin@example.com', domains: ['example.com'], role: 'admin' })
}, 15000)
afterAll(() => s.stop())

describe('POST /events/bounce', () => {
  it('returns 400 when address is missing', async () => {
    const r = await s.post('/events/bounce', {})
    expect(r.status).toBe(400)
  })

  it('suppresses a single address', async () => {
    const r = await s.post('/events/bounce', { address: 'bad@example.com' })
    expect(r.status).toBe(200)
    const body = await r.json() as { suppressed: string[] }
    expect(body.suppressed).toContain('bad@example.com')
  })

  it('suppresses multiple addresses', async () => {
    const r = await s.post('/events/bounce', { addresses: ['a@example.com', 'b@example.com'] })
    expect(r.status).toBe(200)
    const body = await r.json() as { suppressed: string[] }
    expect(body.suppressed).toHaveLength(2)
  })

  it('is idempotent', async () => {
    await s.post('/events/bounce', { address: 'idem@example.com' })
    const r = await s.post('/events/bounce', { address: 'idem@example.com' })
    expect(r.status).toBe(200)

    // Confirm only one suppression record
    const list = await s.get('/suppressed', { token: admin })
    const body = await list.json() as Array<{ address: string }>
    const count = body.filter(x => x.address === 'idem@example.com').length
    expect(count).toBe(1)
  })
})

describe('POST /events/complaint', () => {
  it('suppresses with complaint reason', async () => {
    const r = await s.post('/events/complaint', { address: 'spam@example.com' })
    expect(r.status).toBe(200)
    const body = await r.json() as { suppressed: string[] }
    expect(body.suppressed).toContain('spam@example.com')
  })
})

describe('GET /suppressed', () => {
  it('returns 401 without token', async () => {
    const r = await s.get('/suppressed')
    expect(r.status).toBe(401)
  })

  it('returns 403 for viewer', async () => {
    const viewer = s.token({ email: 'v@example.com', domains: ['example.com'], role: 'viewer' })
    const r = await s.get('/suppressed', { token: viewer })
    expect(r.status).toBe(403)
  })

  it('returns suppressed list for admin', async () => {
    const r = await s.get('/suppressed', { token: admin })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('DELETE /suppressed/:address', () => {
  it('removes an address', async () => {
    await s.post('/events/bounce', { address: 'remove-me@example.com' })
    const del = await s.delete('/suppressed/remove-me@example.com', { token: admin })
    expect(del.status).toBe(200)
    const body = await del.json() as { removed: string }
    expect(body.removed).toBe('remove-me@example.com')
  })
})
