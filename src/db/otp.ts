import type Fylo from '@delma/fylo'
import type { OtpSession } from '../types.ts'
import { Collections, collect } from './index.ts'

/**
 * Finds an SMS OTP session by its logical `id` field.
 * Returns `[docId, session]`. Returns `[null, null]` when not found.
 */
export async function findOtpSession(
  fylo: Fylo,
  id: string
): Promise<[string | null, OtpSession | null]> {
  const docs = await collect<OtpSession>(
    fylo.findDocs<OtpSession>(Collections.OTP_SESSIONS, {
      $ops: [{ id: { $eq: id } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** Stores a new SMS OTP session. Returns the Fylo document ID. */
export async function putOtpSession(fylo: Fylo, session: OtpSession): Promise<string> {
  return await fylo.putData(Collections.OTP_SESSIONS, session)
}

/** Permanently removes an OTP session document. */
export async function deleteOtpSession(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.OTP_SESSIONS, docId)
}

/**
 * Returns an existing non-expired OTP session for the given email + phone,
 * or null if none exists. Used to avoid creating duplicate sessions when
 * one has already been seeded (e.g. in E2E tests) or when the user re-requests.
 */
export async function findValidOtpSession(
  fylo: Fylo,
  email: string,
  phone: string
): Promise<OtpSession | null> {
  const docs = await collect<OtpSession>(
    fylo.findDocs<OtpSession>(Collections.OTP_SESSIONS, {
      $ops: [{ email: { $eq: email } } as any],
    }).collect()
  )
  const now = new Date()
  const valid = Object.values(docs).find(
    s => s.phone === phone && new Date(s.expiresAt) >= now
  )
  return valid ?? null
}

/**
 * Deletes all expired OTP sessions for the given email.
 * Called before creating a new session to avoid stale accumulation.
 */
export async function purgeExpiredOtpSessions(fylo: Fylo, email: string): Promise<void> {
  const docs = await collect<OtpSession>(
    fylo.findDocs<OtpSession>(Collections.OTP_SESSIONS, {
      $ops: [{ email: { $eq: email } } as any],
    }).collect()
  )
  const now = new Date()
  await Promise.all(
    Object.entries(docs)
      .filter(([, s]) => new Date(s.expiresAt) < now)
      .map(([docId]) => fylo.delDoc(Collections.OTP_SESSIONS, docId))
  )
}
