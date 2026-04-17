import type Fylo from '@delma/fylo'
import type { InboxRule, RuleCondition, InboxRuleAction } from '../types.ts'
import { Collections, collect } from './index.ts'

// ── Serialization ─────────────────────────────────────────────────────────────
// Fylo stores nested arrays as JSON strings. These helpers convert between
// the typed InboxRule interface and the flat shape stored on disk.

type RawRuleDoc = Omit<InboxRule, 'conditions' | 'actions'> & {
  conditions: string | RuleCondition[]
  actions: string | InboxRuleAction[]
}

function deserialize(raw: RawRuleDoc): InboxRule {
  return {
    ...raw,
    conditions: typeof raw.conditions === 'string' ? JSON.parse(raw.conditions) : (raw.conditions ?? []),
    actions:    typeof raw.actions    === 'string' ? JSON.parse(raw.actions)    : (raw.actions    ?? []),
  }
}

function serialize(rule: Omit<InboxRule, 'id'> & { id?: string }): RawRuleDoc {
  return {
    ...rule,
    conditions: JSON.stringify(rule.conditions ?? []),
    actions:    JSON.stringify(rule.actions ?? []),
  } as RawRuleDoc
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns inbox rules for the given domains, with conditions/actions deserialized.
 */
export async function listRules(
  fylo: Fylo,
  allowedDomains: string[]
): Promise<InboxRule[]> {
  const docs = await collect<RawRuleDoc>(
    fylo.findDocs<RawRuleDoc>(Collections.INBOX_RULES, { $ops: [] }).collect()
  )
  return Object.values(docs)
    .filter(r => allowedDomains.includes(r.domain))
    .map(deserialize)
}

/**
 * Returns all enabled inbox rules for a given domain (for inbound email processing).
 */
export async function listEnabledRulesForDomain(
  fylo: Fylo,
  domain: string
): Promise<InboxRule[]> {
  const docs = await collect<RawRuleDoc>(
    fylo.findDocs<RawRuleDoc>(Collections.INBOX_RULES, {
      $ops: [{ domain: { $eq: domain } } as any],
    }).collect()
  )
  return Object.values(docs)
    .filter(r => r.enabled)
    .map(deserialize)
}

/**
 * Finds an inbox rule by its logical `id` field. Returns `[docId, rule]`.
 * Returns `[null, null]` when not found.
 */
export async function findRuleById(
  fylo: Fylo,
  ruleId: string
): Promise<[string | null, InboxRule | null]> {
  const docs = await collect<RawRuleDoc>(
    fylo.findDocs<RawRuleDoc>(Collections.INBOX_RULES, {
      $ops: [{ id: { $eq: ruleId } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], deserialize(entry[1])] : [null, null]
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Stores a new inbox rule. Returns the Fylo document ID. */
export async function putRule(fylo: Fylo, rule: InboxRule): Promise<string> {
  return await fylo.putData(Collections.INBOX_RULES, serialize(rule))
}

/** Applies a partial update to an inbox rule document. */
export async function updateRule(
  fylo: Fylo,
  docId: string,
  patch: Partial<InboxRule>
): Promise<void> {
  const serialized: Record<string, unknown> = {}
  if (patch.name      !== undefined) serialized.name           = patch.name
  if (patch.enabled   !== undefined) serialized.enabled        = patch.enabled
  if (patch.conditionMatch !== undefined) serialized.conditionMatch = patch.conditionMatch
  if (patch.conditions !== undefined) serialized.conditions    = JSON.stringify(patch.conditions)
  if (patch.actions   !== undefined) serialized.actions        = JSON.stringify(patch.actions)
  await fylo.patchDoc(Collections.INBOX_RULES, { [docId]: serialized })
}

/** Permanently removes an inbox rule document. */
export async function deleteRule(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.INBOX_RULES, docId)
}
