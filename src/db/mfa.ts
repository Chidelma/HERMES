import type Fylo from '@delma/fylo'
import type { MfaDevice, MfaSession, SetupSession } from '../types.ts'
import { Collections, collect } from './index.ts'

// ── MFA Devices ───────────────────────────────────────────────────────────────

/** Returns all registered TOTP devices for a user. */
export async function listDevices(fylo: Fylo, userEmail: string): Promise<Array<MfaDevice & { docId: string }>> {
  const docs = await collect<MfaDevice>(
    fylo.findDocs<MfaDevice>(Collections.MFA_DEVICES, {
      $ops: [{ userEmail: { $eq: userEmail } } as any],
    }).collect()
  )
  return Object.entries(docs).map(([docId, d]) => ({ docId, ...d }))
}

/**
 * Finds a device by its logical `id` field. Returns `[docId, device]`.
 * Returns `[null, null]` when not found.
 */
export async function findDeviceById(
  fylo: Fylo,
  id: string
): Promise<[string | null, MfaDevice | null]> {
  const docs = await collect<MfaDevice>(
    fylo.findDocs<MfaDevice>(Collections.MFA_DEVICES, {
      $ops: [{ id: { $eq: id } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** Stores a new MFA device. Returns the Fylo document ID. */
export async function putDevice(fylo: Fylo, device: MfaDevice): Promise<string> {
  return await fylo.putData(Collections.MFA_DEVICES, device)
}

/** Permanently removes an MFA device document. */
export async function deleteDevice(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.MFA_DEVICES, docId)
}

// ── MFA Sessions ──────────────────────────────────────────────────────────────

/**
 * Finds an active MFA session by its logical `id` field.
 * Returns `[docId, session]`. Returns `[null, null]` when not found.
 */
export async function findMfaSession(
  fylo: Fylo,
  id: string
): Promise<[string | null, MfaSession | null]> {
  const docs = await collect<MfaSession>(
    fylo.findDocs<MfaSession>(Collections.MFA_SESSIONS, {
      $ops: [{ id: { $eq: id } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** Stores a new MFA session. Returns the Fylo document ID. */
export async function putMfaSession(fylo: Fylo, session: MfaSession): Promise<string> {
  return await fylo.putData(Collections.MFA_SESSIONS, session)
}

/** Permanently removes an MFA session document. */
export async function deleteMfaSession(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.MFA_SESSIONS, docId)
}

/**
 * Deletes all expired MFA sessions for the given email.
 * Called before creating a new session to avoid stale accumulation.
 */
export async function purgeExpiredMfaSessions(fylo: Fylo, email: string): Promise<void> {
  const docs = await collect<MfaSession>(
    fylo.findDocs<MfaSession>(Collections.MFA_SESSIONS, {
      $ops: [{ email: { $eq: email } } as any],
    }).collect()
  )
  const now = new Date()
  await Promise.all(
    Object.entries(docs)
      .filter(([, s]) => new Date(s.expiresAt) < now)
      .map(([docId]) => fylo.delDoc(Collections.MFA_SESSIONS, docId))
  )
}

// ── Setup Sessions ────────────────────────────────────────────────────────────

/**
 * Finds a pending device setup session by its logical `id` field.
 * Returns `[docId, session]`. Returns `[null, null]` when not found.
 */
export async function findSetupSession(
  fylo: Fylo,
  id: string
): Promise<[string | null, SetupSession | null]> {
  const docs = await collect<SetupSession>(
    fylo.findDocs<SetupSession>(Collections.SETUP_SESSIONS, {
      $ops: [{ id: { $eq: id } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** Stores a new device setup session. Returns the Fylo document ID. */
export async function putSetupSession(fylo: Fylo, session: SetupSession): Promise<string> {
  return await fylo.putData(Collections.SETUP_SESSIONS, session)
}

/** Permanently removes a setup session document. */
export async function deleteSetupSession(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.SETUP_SESSIONS, docId)
}
