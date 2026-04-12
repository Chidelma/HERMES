import type { SQSEvent, SQSRecord } from 'aws-lambda'
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses'
import { getFylo, Collections } from '../shared/fylo'
import type { DomainConfig, StoredEmail, RouteRule } from '../shared/types'

const ses = new SESClient({})

export async function handler(event: SQSEvent): Promise<void> {
  const fylo = await getFylo()

  for (const record of event.Records) {
    await processRecord(fylo, record)
  }
}

async function processRecord(fylo: Awaited<ReturnType<typeof getFylo>>, record: SQSRecord): Promise<void> {
  const body = JSON.parse(record.body)
  const sesNotification = JSON.parse(body.Message ?? body.body ?? record.body)
  const mail = sesNotification?.mail
  const receipt = sesNotification?.receipt

  if (!mail || !receipt) return

  const recipients: string[] = receipt.recipients ?? []
  const sender: string = mail.source ?? ''
  const subject: string = mail.commonHeaders?.subject ?? '(no subject)'
  const messageId: string = mail.messageId ?? record.messageId
  const body: string = extractTextBody(sesNotification.content ?? '')

  for (const recipient of recipients) {
    const domain = recipient.split('@')[1]?.toLowerCase()
    if (!domain) continue

    const domainDocs = await getDomainConfig(fylo, domain)
    if (!domainDocs) continue

    const rule = matchRoute(domainDocs.routes, recipient)
    if (!rule) continue

    const emailId = await fylo.putData(Collections.EMAILS, {
      id: messageId,
      domain,
      recipient,
      sender,
      subject,
      rawKey: messageId,
      body,
      receivedAt: new Date().toISOString(),
      processed: false,
    } satisfies StoredEmail)

    await applyRouteAction(fylo, rule, emailId, sender, recipient, subject)
  }
}

async function getDomainConfig(fylo: Awaited<ReturnType<typeof getFylo>>, domain: string): Promise<DomainConfig | null> {
  const results: Record<string, any> = {}
  for await (const doc of fylo.findDocs(Collections.DOMAINS, {
    $ops: [{ domain: { $eq: domain } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const raw = Object.values(results)[0]
  if (!raw) return null
  return { ...raw, routes: typeof raw.routes === 'string' ? JSON.parse(raw.routes) : (raw.routes ?? []) }
}

function matchRoute(rules: RouteRule[], recipient: string): RouteRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.match === recipient) return rule
    if (rule.match.startsWith('*@') && recipient.endsWith(rule.match.slice(1))) return rule
    if (rule.match === '*') return rule
  }
  return null
}

async function applyRouteAction(
  fylo: Awaited<ReturnType<typeof getFylo>>,
  rule: RouteRule,
  emailId: string,
  sender: string,
  recipient: string,
  subject: string
): Promise<void> {
  if (rule.action.type === 'drop') return

  if (rule.action.type === 'store') {
    await fylo.patchDoc(Collections.EMAILS, { [emailId]: { processed: true } })
    return
  }

  if (rule.action.type === 'webhook') {
    const { url, secret } = rule.action
    const payload = JSON.stringify({ emailId, sender, recipient, subject })
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) {
      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
      headers['X-Hermes-Signature'] = Buffer.from(sig).toString('hex')
    }
    await fetch(url, { method: 'POST', headers, body: payload })
    await fylo.patchDoc(Collections.EMAILS, { [emailId]: { processed: true } })
    return
  }

  if (rule.action.type === 'forward') {
    await ses.send(new SendRawEmailCommand({
      Destinations: [rule.action.to],
      RawMessage: { Data: Buffer.from(`From: ${sender}\r\nTo: ${rule.action.to}\r\nSubject: Fwd: ${subject}\r\n\r\n`) },
    }))
    await fylo.patchDoc(Collections.EMAILS, { [emailId]: { processed: true } })
  }
}

function extractTextBody(mime: string): string {
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

  // Non-multipart: body starts after the blank line separating headers
  const sep = mime.indexOf('\r\n\r\n')
  return sep !== -1 ? mime.slice(sep + 4).trim() : mime
}
