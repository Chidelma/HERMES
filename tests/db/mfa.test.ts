import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../../src/db/index.ts'
import {
  listDevices,
  findDeviceById,
  putDevice,
  deleteDevice,
  findMfaSession,
  putMfaSession,
  deleteMfaSession,
  purgeExpiredMfaSessions,
  findSetupSession,
  putSetupSession,
  deleteSetupSession,
} from '../../src/db/mfa.ts'
import type Fylo from '@delma/fylo'
import type { MfaDevice, MfaSession, SetupSession } from '../../src/types.ts'

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

const device: MfaDevice = {
  id: 'dev-001',
  userEmail: 'alice@example.com',
  name: 'Authenticator App',
  secret: 'JBSWY3DPEHPK3PXP',
  createdAt: '2024-01-01T00:00:00.000Z',
}

// ── MFA Devices ───────────────────────────────────────────────────────────────

describe('putDevice / listDevices', () => {
  it('stores and retrieves a device', async () => {
    await putDevice(fylo, device)
    const devices = await listDevices(fylo, 'alice@example.com')
    expect(devices).toHaveLength(1)
    expect(devices[0].name).toBe('Authenticator App')
  })

  it('scopes devices by email', async () => {
    await putDevice(fylo, device)
    await putDevice(fylo, { ...device, id: 'dev-002', userEmail: 'bob@example.com' })

    const aliceDevices = await listDevices(fylo, 'alice@example.com')
    const bobDevices   = await listDevices(fylo, 'bob@example.com')

    expect(aliceDevices).toHaveLength(1)
    expect(bobDevices).toHaveLength(1)
    expect(aliceDevices[0].userEmail).toBe('alice@example.com')
  })
})

describe('findDeviceById', () => {
  it('finds a device by logical id', async () => {
    await putDevice(fylo, device)
    const [docId, found] = await findDeviceById(fylo, 'dev-001')
    expect(docId).not.toBeNull()
    expect(found!.name).toBe('Authenticator App')
  })

  it('returns [null, null] when not found', async () => {
    const [docId, found] = await findDeviceById(fylo, 'dev-999')
    expect(docId).toBeNull()
    expect(found).toBeNull()
  })
})

describe('deleteDevice', () => {
  it('removes the device', async () => {
    await putDevice(fylo, device)
    const [docId] = await findDeviceById(fylo, 'dev-001')
    await deleteDevice(fylo, docId!)

    const devices = await listDevices(fylo, 'alice@example.com')
    expect(devices).toHaveLength(0)
  })
})

// ── MFA Sessions ──────────────────────────────────────────────────────────────

describe('putMfaSession / findMfaSession', () => {
  it('stores and retrieves a session', async () => {
    const session: MfaSession = {
      id: 'sess-001',
      email: 'alice@example.com',
      expiresAt: inMinutes(5),
    }
    await putMfaSession(fylo, session)
    const [docId, found] = await findMfaSession(fylo, 'sess-001')
    expect(docId).not.toBeNull()
    expect(found!.email).toBe('alice@example.com')
  })

  it('returns [null, null] when not found', async () => {
    const [docId, found] = await findMfaSession(fylo, 'no-such-session')
    expect(docId).toBeNull()
    expect(found).toBeNull()
  })
})

describe('deleteMfaSession', () => {
  it('removes the session', async () => {
    const session: MfaSession = { id: 'sess-001', email: 'alice@example.com', expiresAt: inMinutes(5) }
    await putMfaSession(fylo, session)
    const [docId] = await findMfaSession(fylo, 'sess-001')
    await deleteMfaSession(fylo, docId!)

    const [, after] = await findMfaSession(fylo, 'sess-001')
    expect(after).toBeNull()
  })
})

describe('purgeExpiredMfaSessions', () => {
  it('deletes expired sessions for the given email', async () => {
    const expired: MfaSession  = { id: 'sess-exp', email: 'alice@example.com', expiresAt: inMinutes(-10) }
    const active:  MfaSession  = { id: 'sess-act', email: 'alice@example.com', expiresAt: inMinutes(5) }
    await putMfaSession(fylo, expired)
    await putMfaSession(fylo, active)

    await purgeExpiredMfaSessions(fylo, 'alice@example.com')

    const [, expiredAfter] = await findMfaSession(fylo, 'sess-exp')
    const [, activeAfter]  = await findMfaSession(fylo, 'sess-act')

    expect(expiredAfter).toBeNull()
    expect(activeAfter).not.toBeNull()
  })

  it('does not affect sessions for other emails', async () => {
    const bobSession: MfaSession = { id: 'bob-sess', email: 'bob@example.com', expiresAt: inMinutes(-5) }
    await putMfaSession(fylo, bobSession)

    await purgeExpiredMfaSessions(fylo, 'alice@example.com')

    const [, found] = await findMfaSession(fylo, 'bob-sess')
    expect(found).not.toBeNull()
  })
})

// ── Setup Sessions ────────────────────────────────────────────────────────────

describe('putSetupSession / findSetupSession', () => {
  it('stores and retrieves a setup session', async () => {
    const session: SetupSession = {
      id: 'setup-001',
      email: 'alice@example.com',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      expiresAt: inMinutes(15),
    }
    await putSetupSession(fylo, session)
    const [docId, found] = await findSetupSession(fylo, 'setup-001')
    expect(docId).not.toBeNull()
    expect(found!.totpSecret).toBe('JBSWY3DPEHPK3PXP')
  })

  it('returns [null, null] when not found', async () => {
    const [docId, found] = await findSetupSession(fylo, 'no-setup')
    expect(docId).toBeNull()
    expect(found).toBeNull()
  })
})

describe('deleteSetupSession', () => {
  it('removes the setup session', async () => {
    const session: SetupSession = {
      id: 'setup-001',
      email: 'alice@example.com',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      expiresAt: inMinutes(15),
    }
    await putSetupSession(fylo, session)
    const [docId] = await findSetupSession(fylo, 'setup-001')
    await deleteSetupSession(fylo, docId!)

    const [, after] = await findSetupSession(fylo, 'setup-001')
    expect(after).toBeNull()
  })
})
