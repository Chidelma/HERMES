import { createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export const BASE_URL = (process.env.HERMES_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '')
export const IMAGE = process.env.HERMES_IMAGE ?? 'hermes:blackbox'
export const INBOUND_WEBHOOK_SECRET = process.env.INBOUND_WEBHOOK_SECRET ?? 'blackbox-webhook-secret'

export function hmacSha256Hex(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function signWebhookBody(body, secret = INBOUND_WEBHOOK_SECRET) {
  return hmacSha256Hex(secret, JSON.stringify(body ?? {}))
}

export async function request(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, init)
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : undefined } catch { body = text }
  return { status: res.status, headers: res.headers, body }
}

export function dockerRun(args, { input } = {}) {
  const result = spawnSync('docker', ['run', '--rm', ...args], {
    encoding: 'utf8',
    input,
    timeout: 30_000,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}
