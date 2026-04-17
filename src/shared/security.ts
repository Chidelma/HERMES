import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const CONTROL_CHARS = /[\u0000\r\n]/
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"\u0000-\u001f]+@[a-z0-9.-]+\.[a-z]{2,63}$/i

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function isTestRoutesEnabled(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.HERMES_ENABLE_TEST_ROUTES === 'true'
}

export function timingSafeStringEqual(actual: string, expected: string, encoding: BufferEncoding = 'utf8'): boolean {
  const actualBuffer = Buffer.from(actual, encoding)
  const expectedBuffer = Buffer.from(expected, encoding)
  if (actualBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(actualBuffer, Buffer.alloc(actualBuffer.length))
    return false
  }
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyHmacSha256Hex(signature: string | undefined, secret: string, payload: string): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false
  return timingSafeStringEqual(signature.toLowerCase(), hmacSha256Hex(secret, payload), 'ascii')
}

export function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const wanted = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted)
  return entry?.[1]
}

export function jsonSigningPayload(body: unknown): string {
  return JSON.stringify(body ?? {})
}

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value)
}

export function normalizeEmailAddress(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return null
  if (hasControlChars(email)) return null
  return email
}

export function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase()
  if (!DOMAIN_RE.test(domain)) return null
  if (hasControlChars(domain)) return null
  return domain
}

export function hasDomainClaim(claimedDomains: string[], domain: string): boolean {
  return claimedDomains.map(d => d.toLowerCase()).includes(domain.toLowerCase())
}

export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Webhook URL is invalid')
  }

  if (parsed.protocol !== 'https:') throw new Error('Webhook URL must use https')
  if (parsed.username || parsed.password) throw new Error('Webhook URL credentials are not allowed')

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Webhook URL host is not allowed')
  }
  if (isUnsafeIpOrHostname(hostname)) throw new Error('Webhook URL host is not allowed')

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(address => isUnsafeIpOrHostname(address.address))) {
    throw new Error('Webhook URL resolves to a private or local address')
  }
}

function isUnsafeIpOrHostname(host: string): boolean {
  const clean = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  const ipVersion = isIP(clean)
  if (ipVersion === 4) return isUnsafeIpv4(clean)
  if (ipVersion === 6) return isUnsafeIpv6(clean)
  return clean === 'localhost'
    || clean.endsWith('.local')
    || clean.endsWith('.internal')
}

function isUnsafeIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
}

function isUnsafeIpv6(ip: string): boolean {
  const clean = ip.toLowerCase()
  return clean === '::'
    || clean === '::1'
    || clean.startsWith('::ffff:127.')
    || clean.startsWith('::ffff:10.')
    || clean.startsWith('fc')
    || clean.startsWith('fd')
    || clean.startsWith('fe80')
}
