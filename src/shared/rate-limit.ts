import type Fylo from '@delma/fylo'
import { Collections, collect } from '../db/index.ts'
import { sha256Hex } from './security.ts'

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

interface RateLimitRecord {
  key: string
  count: number
  resetAt: string
}

export async function checkRateLimit(
  fylo: Fylo,
  keyParts: string[],
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now()
  const key = sha256Hex(keyParts.join('\u001f'))
  const docs = await collect<RateLimitRecord>(
    fylo.findDocs<RateLimitRecord>(Collections.RATE_LIMITS, {
      $ops: [{ key: { $eq: key } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]

  if (!entry) {
    await fylo.putData(Collections.RATE_LIMITS, {
      key,
      count: 1,
      resetAt: new Date(now + windowMs).toISOString(),
    } satisfies RateLimitRecord)
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const [docId, record] = entry
  const resetAt = new Date(record.resetAt).getTime()
  if (Number.isNaN(resetAt) || resetAt <= now) {
    await fylo.patchDoc(Collections.RATE_LIMITS, {
      [docId]: { count: 1, resetAt: new Date(now + windowMs).toISOString() },
    })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (record.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((resetAt - now) / 1000) }
  }

  await fylo.patchDoc(Collections.RATE_LIMITS, {
    [docId]: { count: record.count + 1 },
  })
  return { allowed: true, retryAfterSeconds: 0 }
}
