import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../../src/db/index.ts'
import {
  findOtpSession,
  putOtpSession,
  deleteOtpSession,
  purgeExpiredOtpSessions,
} from '../../src/db/otp.ts'
import type Fylo from '@delma/fylo'
import type { OtpSession } from '../../src/types.ts'

let fylo: Fylo
let testRoot: string

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'hermes-test-'))
  fylo = await createDb(testRoot)
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

function inMinutes(n: number): string {
  return new Date(Date.now() + n * 60 * 1000).toISOString()
}

const session: OtpSession = {
  id: 'otp-001',
  email: 'alice@example.com',
  phone: '+15551234567',
  codeHash: 'abc123hash',
  expiresAt: inMinutes(5),
}

describe('putOtpSession / findOtpSession', () => {
  it('stores and retrieves a session', async () => {
    await putOtpSession(fylo, session)
    const [docId, found] = await findOtpSession(fylo, 'otp-001')
    expect(docId).not.toBeNull()
    expect(found!.email).toBe('alice@example.com')
    expect(found!.phone).toBe('+15551234567')
    expect(found!.codeHash).toBe('abc123hash')
  })

  it('returns [null, null] when not found', async () => {
    const [docId, found] = await findOtpSession(fylo, 'no-such-session')
    expect(docId).toBeNull()
    expect(found).toBeNull()
  })
})

describe('deleteOtpSession', () => {
  it('removes the session', async () => {
    await putOtpSession(fylo, session)
    const [docId] = await findOtpSession(fylo, 'otp-001')
    await deleteOtpSession(fylo, docId!)

    const [, after] = await findOtpSession(fylo, 'otp-001')
    expect(after).toBeNull()
  })
})

describe('purgeExpiredOtpSessions', () => {
  it('deletes expired sessions for the given email', async () => {
    const expired: OtpSession = { ...session, id: 'otp-exp', expiresAt: inMinutes(-10) }
    const active:  OtpSession = { ...session, id: 'otp-act', expiresAt: inMinutes(5) }
    await putOtpSession(fylo, expired)
    await putOtpSession(fylo, active)

    await purgeExpiredOtpSessions(fylo, 'alice@example.com')

    const [, expiredAfter] = await findOtpSession(fylo, 'otp-exp')
    const [, activeAfter]  = await findOtpSession(fylo, 'otp-act')

    expect(expiredAfter).toBeNull()
    expect(activeAfter).not.toBeNull()
  })

  it('does not purge sessions for other emails', async () => {
    const bobSession: OtpSession = {
      ...session,
      id: 'bob-otp',
      email: 'bob@example.com',
      expiresAt: inMinutes(-5),
    }
    await putOtpSession(fylo, bobSession)

    await purgeExpiredOtpSessions(fylo, 'alice@example.com')

    const [, found] = await findOtpSession(fylo, 'bob-otp')
    expect(found).not.toBeNull()
  })
})
