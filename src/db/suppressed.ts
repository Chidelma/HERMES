import type Fylo from '@delma/fylo'
import type { SuppressedAddress } from '../types.ts'
import { Collections, collect } from './index.ts'

/** Returns all suppressed addresses. */
export async function listSuppressed(fylo: Fylo): Promise<SuppressedAddress[]> {
  const docs = await collect<SuppressedAddress>(
    fylo.findDocs<SuppressedAddress>(Collections.SUPPRESSED, { $ops: [] }).collect()
  )
  return Object.values(docs)
}

/**
 * Returns a Set of all suppressed email addresses for fast membership testing.
 * Used by the send handler to block delivery to suppressed recipients.
 */
export async function getSuppressedSet(fylo: Fylo): Promise<Set<string>> {
  const docs = await collect<SuppressedAddress>(
    fylo.findDocs<SuppressedAddress>(Collections.SUPPRESSED, { $ops: [] }).collect()
  )
  return new Set(Object.values(docs).map(r => r.address))
}

/**
 * Adds an address to the suppression list if not already present.
 * Idempotent — subsequent calls for the same address are no-ops.
 */
export async function suppressAddress(
  fylo: Fylo,
  address: string,
  reason: SuppressedAddress['reason']
): Promise<void> {
  const existing = await collect<SuppressedAddress>(
    fylo.findDocs<SuppressedAddress>(Collections.SUPPRESSED, {
      $ops: [{ address: { $eq: address } } as any],
    }).collect()
  )
  if (Object.keys(existing).length > 0) return

  await fylo.putData(Collections.SUPPRESSED, {
    address,
    reason,
    suppressedAt: new Date().toISOString(),
  } satisfies SuppressedAddress)
}

/**
 * Removes all suppression records for an address.
 * Used by admins to un-suppress a previously blocked address.
 */
export async function deleteSuppressed(fylo: Fylo, address: string): Promise<void> {
  const existing = await collect<SuppressedAddress>(
    fylo.findDocs<SuppressedAddress>(Collections.SUPPRESSED, {
      $ops: [{ address: { $eq: address } } as any],
    }).collect()
  )
  await Promise.all(
    Object.keys(existing).map(docId => fylo.delDoc(Collections.SUPPRESSED, docId))
  )
}
