import { createHmac, randomBytes } from 'node:crypto'
import { timingSafeStringEqual } from './security.ts'

// ── Base32 (RFC 4648) ────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf: Buffer): string {
  let output = ''
  let bits = 0
  let val = 0
  for (const byte of buf) {
    val = (val << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(val >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += ALPHABET[(val << (5 - bits)) & 31]
  return output
}

function base32Decode(str: string): Buffer {
  const s = str.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0
  let val = 0
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) continue
    val = (val << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((val >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ── TOTP (RFC 6238 / HOTP RFC 4226) ─────────────────────────────────────────

function hotpCode(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  msg.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac('sha1', key).update(msg).digest()
  const offset = hmac[19] & 0xf
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
       (hmac[offset + 3] & 0xff)) % 1_000_000
  return String(code).padStart(6, '0')
}

/** Generate a cryptographically random TOTP secret (base32-encoded). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** Get the current 6-digit TOTP code for a given secret. Useful in tests. */
export function getTotpCode(secret: string): string {
  return hotpCode(secret, Math.floor(Date.now() / 1000 / 30))
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 * Allows ±drift 30-second windows to tolerate clock skew.
 */
export function verifyTotp(secret: string, code: string, drift = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const counter = Math.floor(Date.now() / 1000 / 30)
  for (let d = -drift; d <= drift; d++) {
    if (timingSafeStringEqual(hotpCode(secret, counter + d), code, 'ascii')) return true
  }
  return false
}

/** Returns an otpauth:// URI for QR code generation or direct app linking. */
export function totpProvisionUri(email: string, secret: string, issuer = 'HERMES'): string {
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?${params}`
}
