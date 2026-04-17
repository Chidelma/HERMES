import type Fylo from '@delma/fylo'
import { Collections, collect } from '../db/index.ts'
import { deleteEmail, findEmailById } from '../db/emails.ts'
import { listEnabledRulesForDomain } from '../db/rules.ts'
import { getSmtpAdapter } from './smtp.ts'
import type { RouteRule, InboxRule, RuleCondition } from '../types.ts'
import type { ParsedAttachment } from '../db/attachments.ts'

// ── Route matching ────────────────────────────────────────────────────────────

export function matchRoute(rules: RouteRule[], recipient: string): RouteRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.match === recipient) return rule
    if (rule.match.startsWith('*@') && recipient.endsWith(rule.match.slice(1))) return rule
    if (rule.match === '*') return rule
  }
  return null
}

// ── Route action ──────────────────────────────────────────────────────────────

export async function applyRouteAction(
  fylo: Fylo,
  rule: RouteRule,
  logicalId: string,
  sender: string,
  recipient: string,
  subject: string,
): Promise<void> {
  const smtp = getSmtpAdapter()

  if (rule.action.type === 'store') {
    const [docId] = await findEmailById(fylo, logicalId)
    if (docId) await fylo.patchDoc(Collections.EMAILS, { [docId]: { processed: true } })
    return
  }

  if (rule.action.type === 'webhook') {
    const { url, secret } = rule.action
    const payload = JSON.stringify({ emailId: logicalId, sender, recipient, subject })
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) {
      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      )
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
      headers['X-Hermes-Signature'] = Buffer.from(sig).toString('hex')
    }
    await fetch(url, { method: 'POST', headers, body: payload })
    const [docId] = await findEmailById(fylo, logicalId)
    if (docId) await fylo.patchDoc(Collections.EMAILS, { [docId]: { processed: true } })
    return
  }

  if (rule.action.type === 'forward') {
    await smtp.forwardEmail(sender, rule.action.to, subject)
    const [docId] = await findEmailById(fylo, logicalId)
    if (docId) await fylo.patchDoc(Collections.EMAILS, { [docId]: { processed: true } })
  }
}

// ── Inbox rules ───────────────────────────────────────────────────────────────

export async function applyInboxRules(
  fylo: Fylo,
  logicalId: string,
  domain: string,
  email: { sender: string; recipient: string; subject: string },
): Promise<void> {
  const rules = await listEnabledRulesForDomain(fylo, domain)
  const smtp = getSmtpAdapter()

  for (const rule of rules) {
    if (!conditionsMatch(rule, email)) continue

    for (const action of rule.actions) {
      if (action.type === 'folder') {
        const [docId] = await findEmailById(fylo, logicalId)
        if (docId) await fylo.patchDoc(Collections.EMAILS, { [docId]: { folder: action.folder } })
      } else if (action.type === 'forward') {
        await smtp.forwardEmail(email.sender, action.to, email.subject)
      } else if (action.type === 'delete') {
        const [docId] = await findEmailById(fylo, logicalId)
        if (docId) await deleteEmail(fylo, docId, logicalId)
        return // email is gone; stop processing
      }
    }
  }
}

function conditionsMatch(
  rule: InboxRule,
  email: { sender: string; recipient: string; subject: string },
): boolean {
  if (rule.conditions.length === 0) return true
  const results = rule.conditions.map(c => evaluateCondition(c, email))
  return rule.conditionMatch === 'any' ? results.some(Boolean) : results.every(Boolean)
}

function evaluateCondition(
  condition: RuleCondition,
  email: { sender: string; recipient: string; subject: string },
): boolean {
  const fieldMap: Record<RuleCondition['field'], string> = {
    from:    email.sender,
    to:      email.recipient,
    subject: email.subject,
  }
  const haystack = (fieldMap[condition.field] ?? '').toLowerCase()
  const needle = condition.value.toLowerCase()

  switch (condition.op) {
    case 'equals':     return haystack === needle
    case 'contains':   return haystack.includes(needle)
    case 'startsWith': return haystack.startsWith(needle)
    default:           return false
  }
}

// ── MIME parsing ──────────────────────────────────────────────────────────────

export interface ParsedInboundMessage {
  text: string
  attachments: ParsedAttachment[]
}

type MailParserAttachment = {
  filename?: string
  contentType?: string
  content: Uint8Array | Buffer
  contentDisposition?: string
  cid?: string
}

type MailParserResult = {
  text?: string
  html?: string | false
  attachments?: MailParserAttachment[]
}

export async function parseInboundMessage(raw: string): Promise<ParsedInboundMessage> {
  if (!raw) return { text: '', attachments: [] }
  if (!looksLikeMime(raw)) return { text: raw, attachments: [] }

  try {
    const packageName = 'mailparser'
    const { simpleParser } = await import(packageName) as {
      simpleParser: (source: string | Buffer) => Promise<MailParserResult>
    }
    const parsed = await simpleParser(raw)
    return {
      text: parsed.text || htmlToText(parsed.html) || extractTextBody(raw),
      attachments: (parsed.attachments ?? []).map(attachment => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
        disposition: attachment.contentDisposition,
        contentId: attachment.cid,
      })),
    }
  } catch {
    return { text: extractTextBody(raw), attachments: [] }
  }
}

export function extractTextBody(mime: string): string {
  if (!mime) return ''

  const boundaryMatch = mime.match(/boundary="?([^"\r\n;]+)"?/i)
  if (boundaryMatch) {
    const boundary = boundaryMatch[1]
    const parts = mime.split(`--${boundary}`)
    for (const part of parts) {
      if (/content-type:\s*text\/plain/i.test(part)) {
        const start = part.indexOf('\r\n\r\n')
        if (start === -1) continue
        let text = part.slice(start + 4).replace(/--$/, '').trim()
        if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
          text = text.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        } else if (/content-transfer-encoding:\s*base64/i.test(part)) {
          text = Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf-8')
        }
        return text
      }
    }
  }

  const sep = mime.indexOf('\r\n\r\n')
  return sep !== -1 ? mime.slice(sep + 4).trim() : mime
}

function looksLikeMime(raw: string): boolean {
  return /content-type:/i.test(raw)
    || /content-disposition:\s*attachment/i.test(raw)
    || /content-transfer-encoding:/i.test(raw)
    || /boundary="?[^"\r\n;]+/i.test(raw)
}

function htmlToText(html?: string | false): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}
