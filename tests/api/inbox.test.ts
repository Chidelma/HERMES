import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let adminToken: string

beforeAll(async () => {
  s = await startTestServer()
  adminToken = s.token({ email: 'alice@example.com', domains: ['example.com'], role: 'admin' })
}, 15000)
afterAll(() => s.stop())

async function seedEmail() {
  // Deliver an email via the inbound webhook
  const r = await s.post('/inbound/webhook', {
    recipient: 'alice@example.com',
    sender:    'sender@other.com',
    subject:   'Hello world',
    body:      'Test body',
    messageId: `msg-${Date.now()}`,
  })
  // Domain must be configured with inboundEnabled first; seed it
  return r
}

async function setupDomain() {
  await s.post('/domains', {
    domain: 'example.com',
    routes: [{ id: 'r1', match: '*@example.com', action: { type: 'store' }, enabled: true }],
    inboundEnabled: true,
  }, { token: adminToken })
}

// ── GET /inbox ─────────────────────────────────────────────────────────────────

describe('GET /inbox', () => {
  it('returns 401 without token', async () => {
    const r = await s.get('/inbox')
    expect(r.status).toBe(401)
  })

  it('returns an array for authenticated user', async () => {
    const r = await s.get('/inbox', { token: adminToken })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns delivered emails', async () => {
    await setupDomain()
    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'sender@other.com',
      subject:   'Test email',
      body:      'Body text',
    })
    const r = await s.get('/inbox', { token: adminToken })
    expect(r.status).toBe(200)
    const emails = await r.json() as Array<{ subject: string }>
    const found = emails.find(e => e.subject === 'Test email')
    expect(found).toBeDefined()
  })

  it('searches and filters delivered emails', async () => {
    await setupDomain()
    const key = `search-${Date.now()}`
    const firstId = `${key}-first`
    const secondId = `${key}-second`
    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'billing@vendor.com',
      subject:   `${key} Invoice`,
      body:      'blue receipt for search',
      messageId: firstId,
    })
    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'alerts@vendor.com',
      subject:   `${key} Alert`,
      body:      'green status update',
      messageId: secondId,
    })

    const byBody = await s.get(`/inbox?q=${encodeURIComponent('blue receipt')}`, { token: adminToken })
    expect(byBody.status).toBe(200)
    const bodyResults = await byBody.json() as Array<{ id: string }>
    expect(bodyResults.some(e => e.id === firstId)).toBe(true)
    expect(bodyResults.some(e => e.id === secondId)).toBe(false)

    const bySender = await s.get('/inbox?q=from%3Abilling', { token: adminToken })
    expect(bySender.status).toBe(200)
    const senderResults = await bySender.json() as Array<{ id: string }>
    expect(senderResults.some(e => e.id === firstId)).toBe(true)
  })

  it('searches attachment filenames', async () => {
    await setupDomain()
    const msgId = `attachment-search-${Date.now()}`
    const mime = [
      'Content-Type: multipart/mixed; boundary="hermes-search-boundary"',
      '',
      '--hermes-search-boundary',
      'Content-Type: text/plain',
      '',
      'Body',
      '--hermes-search-boundary',
      'Content-Type: text/plain; name="quarterly-report.txt"',
      'Content-Disposition: attachment; filename="quarterly-report.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('report').toString('base64'),
      '--hermes-search-boundary--',
      '',
    ].join('\r\n')

    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender: 'bob@other.com',
      subject: 'Attachment search',
      body: mime,
      messageId: msgId,
    })

    const r = await s.get('/inbox?q=filename%3Aquarterly&hasAttachment=true', { token: adminToken })
    expect(r.status).toBe(200)
    const emails = await r.json() as Array<{ id: string }>
    expect(emails.some(e => e.id === msgId)).toBe(true)
  })
})

// ── PUT /inbox/:id ─────────────────────────────────────────────────────────────

describe('PUT /inbox/:id', () => {
  it('returns 401 without token', async () => {
    const r = await s.put('/inbox/some-id', { read: true })
    expect(r.status).toBe(401)
  })

  it('updates read, starred, and folder state', async () => {
    await setupDomain()
    const msgId = `state-test-${Date.now()}`
    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'bob@other.com',
      subject:   'State test',
      body:      'Mailbox state',
      messageId: msgId,
    })

    const update = await s.put(`/inbox/${msgId}`, {
      read: true,
      starred: true,
      folder: 'archive',
    }, { token: adminToken })
    expect(update.status).toBe(200)
    const updated = await update.json() as { read: boolean; starred: boolean; folder: string }
    expect(updated.read).toBe(true)
    expect(updated.starred).toBe(true)
    expect(updated.folder).toBe('archive')

    const archive = await s.get('/inbox?folder=archive&starred=true', { token: adminToken })
    expect(archive.status).toBe(200)
    const emails = await archive.json() as Array<{ id: string }>
    expect(emails.some(e => e.id === msgId)).toBe(true)

    const unread = await s.get('/inbox?read=false', { token: adminToken })
    expect(unread.status).toBe(200)
    const unreadEmails = await unread.json() as Array<{ id: string }>
    expect(unreadEmails.some(e => e.id === msgId)).toBe(false)
  })

  it('rejects unsupported updates', async () => {
    await setupDomain()
    const msgId = `bad-state-${Date.now()}`
    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'bob@other.com',
      subject:   'Bad state',
      messageId: msgId,
    })

    const r = await s.put(`/inbox/${msgId}`, { read: 'yes' }, { token: adminToken })
    expect(r.status).toBe(400)
  })
})

// ── GET /inbox/:id ─────────────────────────────────────────────────────────────

describe('GET /inbox/:id', () => {
  it('returns 401 without token', async () => {
    const r = await s.get('/inbox/some-id')
    expect(r.status).toBe(401)
  })

  it('returns 404 for unknown id', async () => {
    const r = await s.get('/inbox/no-such-id', { token: adminToken })
    expect(r.status).toBe(404)
  })

  it('returns the email when found', async () => {
    await setupDomain()
    const msgId = `get-test-${Date.now()}`
    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'bob@other.com',
      subject:   'Single fetch',
      messageId: msgId,
    })
    const r = await s.get(`/inbox/${msgId}`, { token: adminToken })
    expect(r.status).toBe(200)
    const email = await r.json() as { subject: string }
    expect(email.subject).toBe('Single fetch')
  })

  it('returns attachment metadata and content for delivered MIME attachments', async () => {
    await setupDomain()
    const msgId = `attachment-test-${Date.now()}`
    const mime = [
      'Content-Type: multipart/mixed; boundary="hermes-boundary"',
      '',
      '--hermes-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Message with attachment',
      '--hermes-boundary',
      'Content-Type: text/plain; name="hello.txt"',
      'Content-Disposition: attachment; filename="hello.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('hello attachment').toString('base64'),
      '--hermes-boundary--',
      '',
    ].join('\r\n')

    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'bob@other.com',
      subject:   'With attachment',
      body:      mime,
      messageId: msgId,
    })

    const r = await s.get(`/inbox/${msgId}`, { token: adminToken })
    expect(r.status).toBe(200)
    const email = await r.json() as {
      body: string
      attachments: Array<{ id: string; filename: string; contentType: string; size: number; storagePath?: string }>
    }

    expect(email.body).toContain('Message with attachment')
    expect(email.attachments).toHaveLength(1)
    expect(email.attachments[0].filename).toBe('hello.txt')
    expect(email.attachments[0].storagePath).toBeUndefined()

    const attachment = await s.get(`/inbox/${msgId}/attachments/${email.attachments[0].id}`, { token: adminToken })
    expect(attachment.status).toBe(200)
    const payload = await attachment.json() as { filename: string; contentBase64: string }
    expect(payload.filename).toBe('hello.txt')
    expect(Buffer.from(payload.contentBase64, 'base64').toString('utf8')).toBe('hello attachment')
  })
})

// ── DELETE /inbox/:id ─────────────────────────────────────────────────────────

describe('DELETE /inbox/:id', () => {
  it('returns 401 without token', async () => {
    const r = await s.delete('/inbox/some-id')
    expect(r.status).toBe(401)
  })

  it('returns 404 for unknown id', async () => {
    const r = await s.delete('/inbox/no-such-id', { token: adminToken })
    expect(r.status).toBe(404)
  })

  it('deletes the email', async () => {
    await setupDomain()
    const msgId = `del-test-${Date.now()}`
    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender:    'bob@other.com',
      subject:   'To delete',
      messageId: msgId,
    })
    const del = await s.delete(`/inbox/${msgId}`, { token: adminToken })
    expect(del.status).toBe(200)
    const body = await del.json() as { deleted: string }
    expect(body.deleted).toBe(msgId)

    const check = await s.get(`/inbox/${msgId}`, { token: adminToken })
    expect(check.status).toBe(404)
  })

  it('deletes attachment records with the email', async () => {
    await setupDomain()
    const msgId = `del-attachment-${Date.now()}`
    const mime = [
      'Content-Type: multipart/mixed; boundary="hermes-delete-boundary"',
      '',
      '--hermes-delete-boundary',
      'Content-Type: text/plain',
      '',
      'Body',
      '--hermes-delete-boundary',
      'Content-Type: text/plain; name="delete-me.txt"',
      'Content-Disposition: attachment; filename="delete-me.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('remove me').toString('base64'),
      '--hermes-delete-boundary--',
      '',
    ].join('\r\n')

    await s.post('/inbound/webhook', {
      recipient: 'alice@example.com',
      sender: 'bob@other.com',
      subject: 'Delete attachment',
      body: mime,
      messageId: msgId,
    })
    const email = await (await s.get(`/inbox/${msgId}`, { token: adminToken })).json() as {
      attachments: Array<{ id: string }>
    }
    expect(email.attachments).toHaveLength(1)

    const del = await s.delete(`/inbox/${msgId}`, { token: adminToken })
    expect(del.status).toBe(200)

    const attachment = await s.get(`/inbox/${msgId}/attachments/${email.attachments[0].id}`, { token: adminToken })
    expect(attachment.status).toBe(404)
  })
})
