import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let token: string

beforeAll(async () => {
  s = await startTestServer()
  token = s.token({ email: 'alice@example.com', domains: ['example.com'], role: 'admin' })
}, 15000)
afterAll(() => s.stop())

describe('POST /send', () => {
  it('returns 401 without token', async () => {
    const r = await s.post('/send', { to: ['bob@example.com'], subject: 'Hi', text: 'Hello' })
    expect(r.status).toBe(401)
  })

  it('returns 400 when to is missing', async () => {
    const r = await s.post('/send', { subject: 'Hi', text: 'Hello' }, { token })
    expect(r.status).toBe(400)
  })

  it('returns 400 when subject is missing', async () => {
    const r = await s.post('/send', { to: ['bob@example.com'], text: 'Hello' }, { token })
    expect(r.status).toBe(400)
  })

  it('returns 400 when neither text nor html is provided', async () => {
    const r = await s.post('/send', { to: ['bob@example.com'], subject: 'Hi' }, { token })
    expect(r.status).toBe(400)
  })

  it('rejects header injection in subject', async () => {
    const r = await s.post('/send', {
      to: ['bob@example.com'],
      subject: 'Hello\r\nBcc: attacker@example.com',
      text: 'Test',
    }, { token })
    expect(r.status).toBe(400)
  })

  it('rejects oversized recipient lists', async () => {
    const recipients = Array.from({ length: 51 }, (_, i) => `user${i}@example.com`)
    const r = await s.post('/send', {
      to: recipients,
      subject: 'Hello',
      text: 'Test',
    }, { token })
    expect(r.status).toBe(400)
  })

  it('sends email (console adapter) and returns messageId', async () => {
    const r = await s.post('/send', {
      to: ['bob@example.com'],
      subject: 'Hello',
      text: 'Test message',
    }, { token })
    expect(r.status).toBe(200)
    const body = await r.json() as { messageId: string }
    expect(typeof body.messageId).toBe('string')
  })

  it('returns 422 when recipient is suppressed', async () => {
    // Suppress first
    await s.post('/events/bounce', { address: 'suppressed@example.com' })

    const r = await s.post('/send', {
      to: ['suppressed@example.com'],
      subject: 'Hello',
      text: 'Test',
    }, { token })
    expect(r.status).toBe(422)
    const body = await r.json() as { blocked: string[] }
    expect(body.blocked).toContain('suppressed@example.com')
  })
})
