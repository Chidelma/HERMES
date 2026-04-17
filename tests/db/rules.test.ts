import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../../src/db/index.ts'
import {
  listRules,
  listEnabledRulesForDomain,
  findRuleById,
  putRule,
  updateRule,
  deleteRule,
} from '../../src/db/rules.ts'
import type Fylo from '@delma/fylo'
import type { InboxRule } from '../../src/types.ts'

let fylo: Fylo
let testRoot: string

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'hermes-test-'))
  fylo = await createDb(testRoot)
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

const rule: InboxRule = {
  id: 'rule-001',
  domain: 'example.com',
  name: 'Archive newsletters',
  enabled: true,
  conditionMatch: 'any',
  conditions: [
    { field: 'subject', op: 'contains', value: 'newsletter' },
    { field: 'from',    op: 'contains', value: 'noreply' },
  ],
  actions: [
    { type: 'folder', folder: 'newsletters' },
  ],
}

describe('putRule / listRules', () => {
  it('stores and retrieves a rule', async () => {
    await putRule(fylo, rule)
    const rules = await listRules(fylo, ['example.com'])
    expect(rules).toHaveLength(1)
    expect(rules[0].name).toBe('Archive newsletters')
  })

  it('deserializes conditions and actions from JSON strings', async () => {
    await putRule(fylo, rule)
    const rules = await listRules(fylo, ['example.com'])
    expect(Array.isArray(rules[0].conditions)).toBe(true)
    expect(rules[0].conditions).toHaveLength(2)
    expect(rules[0].conditions[0].field).toBe('subject')
    expect(Array.isArray(rules[0].actions)).toBe(true)
    expect(rules[0].actions[0].type).toBe('folder')
  })

  it('filters rules by allowed domains', async () => {
    await putRule(fylo, rule)
    await putRule(fylo, { ...rule, id: 'rule-002', domain: 'other.com', name: 'Other rule' })

    const result = await listRules(fylo, ['example.com'])
    expect(result).toHaveLength(1)
    expect(result[0].domain).toBe('example.com')
  })
})

describe('listEnabledRulesForDomain', () => {
  it('returns only enabled rules for the domain', async () => {
    const disabled: InboxRule = { ...rule, id: 'rule-002', name: 'Disabled', enabled: false }
    await putRule(fylo, rule)
    await putRule(fylo, disabled)

    const results = await listEnabledRulesForDomain(fylo, 'example.com')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Archive newsletters')
  })

  it('returns empty when no enabled rules exist', async () => {
    await putRule(fylo, { ...rule, enabled: false })
    const results = await listEnabledRulesForDomain(fylo, 'example.com')
    expect(results).toHaveLength(0)
  })
})

describe('findRuleById', () => {
  it('finds a rule by logical id', async () => {
    await putRule(fylo, rule)
    const [docId, found] = await findRuleById(fylo, 'rule-001')
    expect(docId).not.toBeNull()
    expect(found!.name).toBe('Archive newsletters')
  })

  it('returns [null, null] when not found', async () => {
    const [docId, found] = await findRuleById(fylo, 'no-such-rule')
    expect(docId).toBeNull()
    expect(found).toBeNull()
  })
})

describe('updateRule', () => {
  it('updates the name', async () => {
    await putRule(fylo, rule)
    const [docId] = await findRuleById(fylo, 'rule-001')
    await updateRule(fylo, docId!, { name: 'Renamed rule' })

    const [, updated] = await findRuleById(fylo, 'rule-001')
    expect(updated!.name).toBe('Renamed rule')
  })

  it('updates the enabled flag', async () => {
    await putRule(fylo, rule)
    const [docId] = await findRuleById(fylo, 'rule-001')
    await updateRule(fylo, docId!, { enabled: false })

    const [, updated] = await findRuleById(fylo, 'rule-001')
    expect(updated!.enabled).toBe(false)
  })

  it('updates conditions', async () => {
    await putRule(fylo, rule)
    const [docId] = await findRuleById(fylo, 'rule-001')
    await updateRule(fylo, docId!, {
      conditions: [{ field: 'from', op: 'equals', value: 'ceo@corp.com' }],
    })

    const [, updated] = await findRuleById(fylo, 'rule-001')
    expect(updated!.conditions).toHaveLength(1)
    expect(updated!.conditions[0].value).toBe('ceo@corp.com')
  })

  it('updates actions', async () => {
    await putRule(fylo, rule)
    const [docId] = await findRuleById(fylo, 'rule-001')
    await updateRule(fylo, docId!, { actions: [{ type: 'delete' }] })

    const [, updated] = await findRuleById(fylo, 'rule-001')
    expect(updated!.actions[0].type).toBe('delete')
  })
})

describe('deleteRule', () => {
  it('removes the rule', async () => {
    await putRule(fylo, rule)
    const [docId] = await findRuleById(fylo, 'rule-001')
    await deleteRule(fylo, docId!)

    const rules = await listRules(fylo, ['example.com'])
    expect(rules).toHaveLength(0)
  })

  it('does not affect other rules', async () => {
    const rule2: InboxRule = { ...rule, id: 'rule-002', name: 'Keep me' }
    await putRule(fylo, rule)
    await putRule(fylo, rule2)

    const [docId] = await findRuleById(fylo, 'rule-001')
    await deleteRule(fylo, docId!)

    const rules = await listRules(fylo, ['example.com'])
    expect(rules).toHaveLength(1)
    expect(rules[0].name).toBe('Keep me')
  })
})
