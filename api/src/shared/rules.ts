import type { InboxRule } from './types'

/**
 * Deserialises a raw Fylo document into a typed InboxRule body.
 * Fylo stores array fields as JSON strings; this normalises them back to arrays.
 */
export function parseInboxRule(raw: Record<string, unknown>): Omit<InboxRule, 'id'> {
  return {
    ...(raw as Omit<InboxRule, 'id'>),
    conditions: typeof raw.conditions === 'string' ? JSON.parse(raw.conditions) : (raw.conditions ?? []),
    actions:    typeof raw.actions    === 'string' ? JSON.parse(raw.actions)    : (raw.actions    ?? []),
  }
}
