import { createHash } from 'node:crypto'
import type Fylo from '@delma/fylo'
import type { PushSubscriptionRecord } from '../types.ts'
import { Collections, collect } from './index.ts'

export function pushSubscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex')
}

export async function listPushSubscriptions(
  fylo: Fylo,
  userEmail: string,
): Promise<Array<PushSubscriptionRecord & { docId: string }>> {
  const docs = await collect<PushSubscriptionRecord>(
    fylo.findDocs<PushSubscriptionRecord>(Collections.PUSH_SUBSCRIPTIONS, {
      $ops: [{ userEmail: { $eq: userEmail.toLowerCase() } } as any],
    }).collect()
  )
  return Object.entries(docs).map(([docId, sub]) => ({ docId, ...sub }))
}

export async function listPushSubscriptionsForAddress(
  fylo: Fylo,
  address: string,
): Promise<Array<PushSubscriptionRecord & { docId: string }>> {
  return await listPushSubscriptions(fylo, address.toLowerCase())
}

export async function findPushSubscriptionById(
  fylo: Fylo,
  id: string,
): Promise<[string | null, PushSubscriptionRecord | null]> {
  const docs = await collect<PushSubscriptionRecord>(
    fylo.findDocs<PushSubscriptionRecord>(Collections.PUSH_SUBSCRIPTIONS, {
      $ops: [{ id: { $eq: id } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

export async function upsertPushSubscription(
  fylo: Fylo,
  subscription: Omit<PushSubscriptionRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<PushSubscriptionRecord> {
  const now = new Date().toISOString()
  const id = pushSubscriptionId(subscription.endpoint)
  const [docId, existing] = await findPushSubscriptionById(fylo, id)
  const record: PushSubscriptionRecord = {
    ...subscription,
    userEmail: subscription.userEmail.toLowerCase(),
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (docId) {
    await fylo.patchDoc(Collections.PUSH_SUBSCRIPTIONS, { [docId]: record })
  } else {
    await fylo.putData(Collections.PUSH_SUBSCRIPTIONS, record)
  }

  return record
}

export async function deletePushSubscriptionByEndpoint(
  fylo: Fylo,
  endpoint: string,
): Promise<boolean> {
  const [docId] = await findPushSubscriptionById(fylo, pushSubscriptionId(endpoint))
  if (!docId) return false
  await fylo.delDoc(Collections.PUSH_SUBSCRIPTIONS, docId)
  return true
}

export async function deletePushSubscriptionDoc(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.PUSH_SUBSCRIPTIONS, docId)
}
