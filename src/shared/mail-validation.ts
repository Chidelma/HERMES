import type { SendRequest } from '../types.ts'
import { hasControlChars, normalizeEmailAddress } from './security.ts'

const MAX_RECIPIENTS_PER_FIELD = 50
const MAX_TOTAL_RECIPIENTS = 100
const MAX_SUBJECT_LENGTH = 255
const MAX_TEXT_LENGTH = 256_000
const MAX_HTML_LENGTH = 512_000

type ValidationResult =
  | { ok: true; value: SendRequest }
  | { ok: false; error: string }

export function validateSendRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'request body required' }
  const input = body as Partial<SendRequest>
  const to = normalizeAddressList(input.to, 'to')
  if (!to.ok) return to
  if (to.value.length === 0) return { ok: false, error: 'to required' }

  const cc = normalizeAddressList(input.cc, 'cc')
  if (!cc.ok) return cc
  const bcc = normalizeAddressList(input.bcc, 'bcc')
  if (!bcc.ok) return bcc
  const replyTo = normalizeAddressList(input.replyTo, 'replyTo')
  if (!replyTo.ok) return replyTo

  const recipientCount = to.value.length + cc.value.length + bcc.value.length
  if (recipientCount > MAX_TOTAL_RECIPIENTS) return { ok: false, error: 'too many recipients' }

  if (typeof input.subject !== 'string' || !input.subject.trim()) {
    return { ok: false, error: 'subject required' }
  }
  const subject = input.subject.trim()
  if (subject.length > MAX_SUBJECT_LENGTH || hasControlChars(subject)) {
    return { ok: false, error: 'subject contains invalid characters' }
  }

  const text = normalizeBody(input.text, MAX_TEXT_LENGTH, 'text')
  if (!text.ok) return text
  const html = normalizeBody(input.html, MAX_HTML_LENGTH, 'html')
  if (!html.ok) return html
  if (text.value == null && html.value == null) return { ok: false, error: 'text or html required' }

  return {
    ok: true,
    value: {
      to: to.value,
      cc: cc.value.length ? cc.value : undefined,
      bcc: bcc.value.length ? bcc.value : undefined,
      replyTo: replyTo.value.length ? replyTo.value : undefined,
      subject,
      text: text.value,
      html: html.value,
    },
  }
}

function normalizeAddressList(value: unknown, field: string): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: `${field} must be an array` }
  if (value.length > MAX_RECIPIENTS_PER_FIELD) return { ok: false, error: `${field} has too many recipients` }

  const addresses: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, error: `${field} contains invalid recipient` }
    const address = normalizeEmailAddress(item)
    if (!address) return { ok: false, error: `${field} contains invalid recipient` }
    addresses.push(address)
  }
  return { ok: true, value: [...new Set(addresses)] }
}

function normalizeBody(value: unknown, maxLength: number, field: string): { ok: true; value?: string } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: undefined }
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` }
  if (value.length > maxLength) return { ok: false, error: `${field} is too large` }
  return { ok: true, value }
}
