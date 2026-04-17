import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../../src/db/index.ts'
import {
  listSuppressed,
  getSuppressedSet,
  suppressAddress,
  deleteSuppressed,
} from '../../src/db/suppressed.ts'
import type Fylo from '@delma/fylo'

let fylo: Fylo
let testRoot: string

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'hermes-test-'))
  fylo = await createDb(testRoot)
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe('suppressAddress / listSuppressed', () => {
  it('adds a bounce suppression', async () => {
    await suppressAddress(fylo, 'bad@example.com', 'bounce')
    const list = await listSuppressed(fylo)
    expect(list).toHaveLength(1)
    expect(list[0].address).toBe('bad@example.com')
    expect(list[0].reason).toBe('bounce')
  })

  it('adds a complaint suppression', async () => {
    await suppressAddress(fylo, 'spam@example.com', 'complaint')
    const list = await listSuppressed(fylo)
    expect(list[0].reason).toBe('complaint')
  })

  it('sets suppressedAt to a recent ISO timestamp', async () => {
    const before = Date.now()
    await suppressAddress(fylo, 'bad@example.com', 'bounce')
    const after = Date.now()

    const [entry] = await listSuppressed(fylo)
    const ts = new Date(entry.suppressedAt).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

describe('suppressAddress idempotency', () => {
  it('does not duplicate an already suppressed address', async () => {
    await suppressAddress(fylo, 'bad@example.com', 'bounce')
    await suppressAddress(fylo, 'bad@example.com', 'bounce')
    await suppressAddress(fylo, 'bad@example.com', 'complaint')

    const list = await listSuppressed(fylo)
    expect(list).toHaveLength(1)
  })
})

describe('getSuppressedSet', () => {
  it('returns a Set of suppressed addresses', async () => {
    await suppressAddress(fylo, 'a@example.com', 'bounce')
    await suppressAddress(fylo, 'b@example.com', 'complaint')

    const set = await getSuppressedSet(fylo)
    expect(set.size).toBe(2)
    expect(set.has('a@example.com')).toBe(true)
    expect(set.has('b@example.com')).toBe(true)
    expect(set.has('c@example.com')).toBe(false)
  })

  it('returns empty set when no suppressions', async () => {
    const set = await getSuppressedSet(fylo)
    expect(set.size).toBe(0)
  })
})

describe('deleteSuppressed', () => {
  it('removes all records for the address', async () => {
    await suppressAddress(fylo, 'bad@example.com', 'bounce')
    await deleteSuppressed(fylo, 'bad@example.com')

    const list = await listSuppressed(fylo)
    expect(list).toHaveLength(0)
  })

  it('does not affect other addresses', async () => {
    await suppressAddress(fylo, 'a@example.com', 'bounce')
    await suppressAddress(fylo, 'b@example.com', 'bounce')

    await deleteSuppressed(fylo, 'a@example.com')

    const list = await listSuppressed(fylo)
    expect(list).toHaveLength(1)
    expect(list[0].address).toBe('b@example.com')
  })

  it('is a no-op for addresses not in the list', async () => {
    await deleteSuppressed(fylo, 'not-suppressed@example.com')
    const list = await listSuppressed(fylo)
    expect(list).toHaveLength(0)
  })
})
