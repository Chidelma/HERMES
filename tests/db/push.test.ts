import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type Fylo from '@delma/fylo'
import { createDb } from '../../src/db/index.ts'
import {
  deletePushSubscriptionByEndpoint,
  findPushSubscriptionById,
  listPushSubscriptions,
  listPushSubscriptionsForAddress,
  pushSubscriptionId,
  upsertPushSubscription,
} from '../../src/db/push.ts'

let fylo: Fylo
let testRoot: string

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'hermes-push-test-'))
  fylo = await createDb(testRoot)
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

const sampleSubscription = {
  userEmail: 'Alice@Example.com',
  endpoint: 'https://push.example.test/subscription/1',
  keys: {
    p256dh: 'p256dh-key',
    auth: 'auth-key',
  },
  userAgent: 'test-browser',
}

describe('push subscriptions', () => {
  it('stores subscriptions with stable endpoint IDs', async () => {
    const stored = await upsertPushSubscription(fylo, sampleSubscription)

    expect(stored.id).toBe(pushSubscriptionId(sampleSubscription.endpoint))
    expect(stored.userEmail).toBe('alice@example.com')

    const [docId, found] = await findPushSubscriptionById(fylo, stored.id)
    expect(docId).not.toBeNull()
    expect(found?.endpoint).toBe(sampleSubscription.endpoint)
  })

  it('lists subscriptions by user address case-insensitively', async () => {
    await upsertPushSubscription(fylo, sampleSubscription)
    await upsertPushSubscription(fylo, {
      ...sampleSubscription,
      userEmail: 'bob@example.com',
      endpoint: 'https://push.example.test/subscription/2',
    })

    const byUser = await listPushSubscriptions(fylo, 'alice@example.com')
    const byAddress = await listPushSubscriptionsForAddress(fylo, 'ALICE@EXAMPLE.COM')

    expect(byUser).toHaveLength(1)
    expect(byAddress).toHaveLength(1)
    expect(byAddress[0].endpoint).toBe(sampleSubscription.endpoint)
  })

  it('updates an existing endpoint instead of duplicating it', async () => {
    const first = await upsertPushSubscription(fylo, sampleSubscription)
    const second = await upsertPushSubscription(fylo, {
      ...sampleSubscription,
      userAgent: 'updated-browser',
    })

    const subscriptions = await listPushSubscriptions(fylo, 'alice@example.com')

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)
    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0].userAgent).toBe('updated-browser')
  })

  it('deletes subscriptions by endpoint', async () => {
    await upsertPushSubscription(fylo, sampleSubscription)

    const deleted = await deletePushSubscriptionByEndpoint(fylo, sampleSubscription.endpoint)
    const remaining = await listPushSubscriptions(fylo, 'alice@example.com')

    expect(deleted).toBe(true)
    expect(remaining).toHaveLength(0)
  })
})
