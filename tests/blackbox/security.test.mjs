import { test, expect } from 'bun:test'
import { request, signWebhookBody, INBOUND_WEBHOOK_SECRET } from './helpers.mjs'

const sampleBody = {
  recipient: 'alice@example.com',
  sender: 'bob@elsewhere.test',
  subject: 'hello',
  body: 'plain text',
}

test('inbound webhook rejects requests without a signature', async () => {
  const res = await request('/inbound/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sampleBody),
  })
  expect(res.status).toBe(401)
})

test('inbound webhook rejects a bogus signature', async () => {
  const res = await request('/inbound/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hermes-Signature': '0'.repeat(64),
    },
    body: JSON.stringify(sampleBody),
  })
  expect(res.status).toBe(401)
})

test('inbound webhook rejects a signature computed with the wrong secret', async () => {
  const wrongSig = signWebhookBody(sampleBody, 'not-the-real-secret')
  const res = await request('/inbound/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hermes-Signature': wrongSig,
    },
    body: JSON.stringify(sampleBody),
  })
  expect(res.status).toBe(401)
})

test('inbound webhook accepts a valid signature (domain not configured path)', async () => {
  const sig = signWebhookBody(sampleBody, INBOUND_WEBHOOK_SECRET)
  const res = await request('/inbound/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hermes-Signature': sig,
    },
    body: JSON.stringify(sampleBody),
  })
  expect(res.status).toBeLessThan(500)
  expect(res.status).not.toBe(401)
})

test('POST /send requires authentication', async () => {
  const res = await request('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: ['x@example.com'], subject: 's', text: 't' }),
  })
  expect(res.status).toBe(401)
})

test('GET /inbox requires authentication', async () => {
  const res = await request('/inbox')
  expect(res.status).toBe(401)
})

test('POST /domains requires authentication', async () => {
  const res = await request('/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'evil.test' }),
  })
  expect(res.status).toBe(401)
})

test('test/reset is blocked in production mode', async () => {
  const res = await request('/test/reset', { method: 'DELETE' })
  expect([403, 404]).toContain(res.status)
})

test('test/seed/otp is blocked in production mode', async () => {
  const res = await request('/test/seed/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x@test', code: '000000' }),
  })
  expect([403, 404]).toContain(res.status)
})

test('requests with a forged JWT are rejected', async () => {
  const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImF0dGFja2VyQGV2aWwudGVzdCIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.invalid'
  const res = await request('/inbox', {
    headers: { Authorization: `Bearer ${forged}` },
  })
  expect(res.status).toBe(401)
})
