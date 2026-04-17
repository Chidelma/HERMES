import type Fylo from '@delma/fylo'
import type { DomainConfig, RouteRule } from '../types.ts'
import { Collections, collect } from './index.ts'

// ── Serialization ─────────────────────────────────────────────────────────────
// Fylo stores nested arrays as JSON strings. These helpers convert between
// the typed DomainConfig interface and the flat shape stored on disk.

type RawDomainDoc = Omit<DomainConfig, 'routes'> & { routes: string | RouteRule[] }

function deserialize(raw: RawDomainDoc): DomainConfig {
  return {
    ...raw,
    routes: typeof raw.routes === 'string' ? JSON.parse(raw.routes) : (raw.routes ?? []),
  }
}

function serialize(config: DomainConfig): RawDomainDoc {
  return { ...config, routes: JSON.stringify(config.routes) }
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns domain configs whose `domain` field appears in the allowed list.
 */
export async function listDomains(
  fylo: Fylo,
  allowedDomains: string[]
): Promise<DomainConfig[]> {
  const docs = await collect<RawDomainDoc>(
    fylo.findDocs<RawDomainDoc>(Collections.DOMAINS, { $ops: [] }).collect()
  )
  return Object.values(docs)
    .filter(d => allowedDomains.includes(d.domain))
    .map(deserialize)
}

/**
 * Finds a domain config by its `domain` name. Returns `[docId, config]`.
 * Returns `[null, null]` when not found.
 */
export async function findDomainEntry(
  fylo: Fylo,
  domain: string
): Promise<[string | null, DomainConfig | null]> {
  const docs = await collect<RawDomainDoc>(
    fylo.findDocs<RawDomainDoc>(Collections.DOMAINS, {
      $ops: [{ domain: { $eq: domain } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], deserialize(entry[1])] : [null, null]
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Stores a new domain config. Returns the Fylo document ID. */
export async function putDomain(fylo: Fylo, config: DomainConfig): Promise<string> {
  return await fylo.putData(Collections.DOMAINS, serialize(config))
}

/** Replaces the full routes array on a domain document. */
export async function updateDomainRoutes(
  fylo: Fylo,
  docId: string,
  routes: RouteRule[]
): Promise<void> {
  await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: JSON.stringify(routes) } })
}

/** Permanently removes a domain document. */
export async function deleteDomain(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.DOMAINS, docId)
}
