import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../../src/db/index.ts'
import {
  listDomains,
  findDomainEntry,
  putDomain,
  updateDomainRoutes,
  deleteDomain,
} from '../../src/db/domains.ts'
import type Fylo from '@delma/fylo'
import type { DomainConfig, RouteRule } from '../../src/types.ts'

let fylo: Fylo
let testRoot: string

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'hermes-test-'))
  fylo = await createDb(testRoot)
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

const exampleDomain: DomainConfig = {
  domain: 'example.com',
  routes: [
    { id: 'r1', match: '*@example.com', action: { type: 'store' }, enabled: true },
  ],
  inboundEnabled: true,
}

const otherDomain: DomainConfig = {
  domain: 'other.com',
  routes: [],
  inboundEnabled: false,
}

describe('putDomain / listDomains', () => {
  it('stores and retrieves a domain config', async () => {
    await putDomain(fylo, exampleDomain)
    const domains = await listDomains(fylo, ['example.com'])
    expect(domains).toHaveLength(1)
    expect(domains[0].domain).toBe('example.com')
    expect(domains[0].inboundEnabled).toBe(true)
  })

  it('deserializes routes from JSON strings', async () => {
    await putDomain(fylo, exampleDomain)
    const [, config] = await findDomainEntry(fylo, 'example.com')
    expect(Array.isArray(config!.routes)).toBe(true)
    expect(config!.routes[0].id).toBe('r1')
    expect(config!.routes[0].action.type).toBe('store')
  })

  it('filters domains by allowed list', async () => {
    await putDomain(fylo, exampleDomain)
    await putDomain(fylo, otherDomain)

    const result = await listDomains(fylo, ['example.com'])
    expect(result).toHaveLength(1)
    expect(result[0].domain).toBe('example.com')
  })

  it('returns empty array when no match', async () => {
    await putDomain(fylo, exampleDomain)
    const result = await listDomains(fylo, ['nowhere.com'])
    expect(result).toHaveLength(0)
  })
})

describe('findDomainEntry', () => {
  it('returns [docId, config] when found', async () => {
    await putDomain(fylo, exampleDomain)
    const [docId, config] = await findDomainEntry(fylo, 'example.com')
    expect(docId).not.toBeNull()
    expect(config).not.toBeNull()
    expect(config!.domain).toBe('example.com')
  })

  it('returns [null, null] when not found', async () => {
    const [docId, config] = await findDomainEntry(fylo, 'nope.com')
    expect(docId).toBeNull()
    expect(config).toBeNull()
  })
})

describe('updateDomainRoutes', () => {
  it('replaces the routes array', async () => {
    await putDomain(fylo, exampleDomain)
    const [docId] = await findDomainEntry(fylo, 'example.com')

    const newRoutes: RouteRule[] = [
      { id: 'r2', match: 'admin@example.com', action: { type: 'forward', to: 'me@other.com' }, enabled: true },
      { id: 'r3', match: '*', action: { type: 'drop' }, enabled: true },
    ]
    await updateDomainRoutes(fylo, docId!, newRoutes)

    const [, updated] = await findDomainEntry(fylo, 'example.com')
    expect(updated!.routes).toHaveLength(2)
    expect(updated!.routes[0].id).toBe('r2')
    expect(updated!.routes[1].action.type).toBe('drop')
  })

  it('serializes webhook action with optional secret', async () => {
    await putDomain(fylo, exampleDomain)
    const [docId] = await findDomainEntry(fylo, 'example.com')

    const routes: RouteRule[] = [
      {
        id: 'wh1',
        match: '*@example.com',
        action: { type: 'webhook', url: 'https://hooks.example.com/endpoint', secret: 'mysecret' },
        enabled: true,
      },
    ]
    await updateDomainRoutes(fylo, docId!, routes)

    const [, updated] = await findDomainEntry(fylo, 'example.com')
    const action = updated!.routes[0].action as { type: string; url: string; secret: string }
    expect(action.type).toBe('webhook')
    expect(action.url).toBe('https://hooks.example.com/endpoint')
    expect(action.secret).toBe('mysecret')
  })
})

describe('deleteDomain', () => {
  it('removes the domain', async () => {
    await putDomain(fylo, exampleDomain)
    const [docId] = await findDomainEntry(fylo, 'example.com')
    await deleteDomain(fylo, docId!)

    const [, config] = await findDomainEntry(fylo, 'example.com')
    expect(config).toBeNull()
  })
})
