import type { InboxRuleAction, RouteRule } from '../types.ts'
import { assertSafeWebhookUrl, hasControlChars, normalizeEmailAddress } from './security.ts'

export async function validateRouteRules(rules: RouteRule[]): Promise<string | null> {
  for (const rule of rules) {
    if (!rule.id || !rule.match || !rule.action || typeof rule.enabled !== 'boolean') {
      return 'route id, match, action, and enabled are required'
    }
    if (hasControlChars(rule.match)) return 'route match contains invalid characters'
    const error = await validateRouteAction(rule.action)
    if (error) return error
  }
  return null
}

export async function validateRouteAction(action: RouteRule['action'] | undefined): Promise<string | null> {
  if (!action) return 'route action is required'
  if (action.type === 'store' || action.type === 'drop') return null
  if (action.type === 'forward') {
    if (!normalizeEmailAddress(action.to)) return 'forward address is invalid'
    return null
  }
  if (action.type === 'webhook') {
    if (!action.secret || hasControlChars(action.secret)) return 'webhook secret is required'
    try {
      await assertSafeWebhookUrl(action.url)
    } catch (err) {
      return err instanceof Error ? err.message : 'Webhook URL is invalid'
    }
    return null
  }
  return 'unsupported route action'
}

export function validateInboxRuleActions(actions: InboxRuleAction[]): string | null {
  for (const action of actions) {
    if (action.type === 'delete') continue
    if (action.type === 'folder') {
      if (!action.folder || hasControlChars(action.folder)) return 'folder action is invalid'
      continue
    }
    if (action.type === 'forward') {
      if (!normalizeEmailAddress(action.to)) return 'forward address is invalid'
      continue
    }
    return 'unsupported inbox rule action'
  }
  return null
}
