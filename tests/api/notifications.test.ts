import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let alice: string
let bob: string

beforeAll(async () => {
  s = await startTestServer()
  alice = s.token({ email: 'alice@example.com', domains: ['example.com'], role: 'admin' })
  bob   = s.token({ email: 'bob@example.com', domains: ['example.com'], role: 'viewer' })
}, 15000)
afterAll(() => s.stop())

const sampleSubscription = {
  endpoint: 'https://push.example.test/subscription/alice-device',
  keys: {
    p256dh: 'p256dh-key',
    auth: 'auth-key',
  },
}

describe('notification endpoints', () => {
  it('requires authentication for VAPID public key', async () => {
    const r = await s.get('/notifications/vapid-public-key')
    expect(r.status).toBe(401)
  })

  it('returns the VAPID public key for authenticated users', async () => {
    const r = await s.get('/notifications/vapid-public-key', { token: alice })
    expect(r.status).toBe(200)
    const body = await r.json() as { publicKey: string }
    expect(body.publicKey.length).toBeGreaterThan(20)
  })

  it('starts with no subscriptions', async () => {
    const r = await s.get('/notifications/subscriptions', { token: alice })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })

  it('rejects incomplete subscription payloads', async () => {
    const r = await s.post('/notifications/subscriptions', { endpoint: 'missing-keys' }, { token: alice })
    expect(r.status).toBe(400)
  })

  it('creates and lists the current user subscription without key material', async () => {
    const r = await s.post('/notifications/subscriptions', sampleSubscription, { token: alice })
    expect(r.status).toBe(200)
    const created = await r.json() as { endpoint: string; keys?: unknown; userEmail: string }
    expect(created.endpoint).toBe(sampleSubscription.endpoint)
    expect(created.userEmail).toBe('alice@example.com')
    expect(created.keys).toBeUndefined()

    const list = await s.get('/notifications/subscriptions', { token: alice })
    expect(list.status).toBe(200)
    const subscriptions = await list.json() as Array<{ endpoint: string; keys?: unknown }>
    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0].endpoint).toBe(sampleSubscription.endpoint)
    expect(subscriptions[0].keys).toBeUndefined()
  })

  it('isolates subscriptions by user', async () => {
    const r = await s.get('/notifications/subscriptions', { token: bob })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })

  it('upserts an existing endpoint', async () => {
    await s.post('/notifications/subscriptions', sampleSubscription, { token: alice })
    await s.post('/notifications/subscriptions', sampleSubscription, { token: alice })

    const list = await s.get('/notifications/subscriptions', { token: alice })
    const subscriptions = await list.json() as Array<{ endpoint: string }>
    expect(subscriptions.filter(sub => sub.endpoint === sampleSubscription.endpoint)).toHaveLength(1)
  })

  it('prevents users from deleting another user subscription', async () => {
    const r = await s.delete('/notifications/subscriptions', {
      token: bob,
      body: { endpoint: sampleSubscription.endpoint },
    })
    expect(r.status).toBe(404)
  })

  it('deletes the current user subscription', async () => {
    const r = await s.delete('/notifications/subscriptions', {
      token: alice,
      body: { endpoint: sampleSubscription.endpoint },
    })
    expect(r.status).toBe(200)
    const body = await r.json() as { deleted: string }
    expect(body.deleted.length).toBeGreaterThan(20)

    const list = await s.get('/notifications/subscriptions', { token: alice })
    expect(await list.json()).toEqual([])
  })
})
