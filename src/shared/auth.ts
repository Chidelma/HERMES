import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireEnv } from './security.ts'

export interface JwtClaims {
  email: string
  domains: string[]
  role: 'admin' | 'viewer'
  iat: number
  exp: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export function signJwt(
  payload: Omit<JwtClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 3600,
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const now = Math.floor(Date.now() / 1000)
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })))
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'ascii'), Buffer.from(expected, 'ascii'))) return null
  } catch {
    return null
  }
  const payload = JSON.parse(fromB64url(body).toString()) as JwtClaims
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

export function getJwtSecret(): string {
  return requireEnv('JWT_SECRET')
}
