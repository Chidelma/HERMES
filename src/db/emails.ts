import type Fylo from '@delma/fylo'
import type { EmailAttachmentSummary, StoredEmail } from '../types.ts'
import { Collections, collect } from './index.ts'
import { deleteAttachmentsForEmail, listAttachmentSummariesByEmail } from './attachments.ts'

export interface EmailListFilters {
  query?: string
  folder?: string
  read?: boolean
  starred?: boolean
  hasAttachment?: boolean
  limit?: number
  offset?: number
}

/**
 * Returns all emails whose domain appears in the allowed list, sorted
 * newest-first by `receivedAt`.
 */
export async function listEmails(
  fylo: Fylo,
  allowedDomains: string[],
  filters: EmailListFilters = {},
): Promise<StoredEmail[]> {
  const docs = await collect<StoredEmail>(
    fylo.findDocs<StoredEmail>(Collections.EMAILS, { $ops: [] }).collect()
  )
  const needsAttachmentData = !!filters.query || filters.hasAttachment != null
  const attachmentsByEmail = needsAttachmentData
    ? await listAttachmentSummariesByEmail(fylo, allowedDomains)
    : new Map<string, EmailAttachmentSummary[]>()

  const offset = Math.max(0, filters.offset ?? 0)
  const limit = filters.limit == null ? undefined : Math.max(0, filters.limit)

  const emails = Object.values(docs)
    .map(normalizeEmail)
    .filter(e => allowedDomains.includes(e.domain))
    .filter(e => !filters.folder || filters.folder === 'all' || (e.folder || 'inbox') === filters.folder)
    .filter(e => filters.read == null || e.read === filters.read)
    .filter(e => filters.starred == null || e.starred === filters.starred)
    .filter(e => filters.hasAttachment == null || (attachmentsByEmail.get(e.id)?.length ?? 0) > 0 === filters.hasAttachment)
    .filter(e => matchesEmailQuery(e, filters.query, attachmentsByEmail.get(e.id) ?? []))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

  return limit == null ? emails.slice(offset) : emails.slice(offset, offset + limit)
}

/** Finds a stored email by its logical `id` field. Returns `[docId, email]`. */
export async function findEmailById(
  fylo: Fylo,
  id: string
): Promise<[string | null, StoredEmail | null]> {
  const docs = await collect<StoredEmail>(
    fylo.findDocs<StoredEmail>(Collections.EMAILS, {
      $ops: [{ id: { $eq: id } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], normalizeEmail(entry[1])] : [null, null]
}

/** Stores a new email. Returns the Fylo document ID (TTID). */
export async function putEmail(
  fylo: Fylo,
  email: StoredEmail
): Promise<string> {
  return await fylo.putData(Collections.EMAILS, email)
}

/** Applies a partial update to an email document. */
export async function updateEmail(
  fylo: Fylo,
  docId: string,
  patch: Partial<StoredEmail>
): Promise<void> {
  await fylo.patchDoc(Collections.EMAILS, { [docId]: patch })
}

/** Permanently removes an email document. */
export async function deleteEmail(fylo: Fylo, docId: string, emailId?: string): Promise<void> {
  if (emailId) await deleteAttachmentsForEmail(fylo, emailId)
  await fylo.delDoc(Collections.EMAILS, docId)
}

export function normalizeEmail(email: StoredEmail): StoredEmail {
  return {
    ...email,
    folder: email.folder || 'inbox',
    read: email.read ?? false,
    starred: email.starred ?? false,
  }
}

function matchesEmailQuery(
  email: StoredEmail,
  query = '',
  attachments: EmailAttachmentSummary[] = [],
): boolean {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (terms.length === 0) return true

  return terms.every(term => matchesEmailTerm(email, term, attachments))
}

function matchesEmailTerm(
  email: StoredEmail,
  term: string,
  attachments: EmailAttachmentSummary[],
): boolean {
  if (term === 'has:attachment') return attachments.length > 0
  if (term === 'is:read') return email.read
  if (term === 'is:unread') return !email.read
  if (term === 'is:starred') return email.starred

  const [rawField, ...rest] = term.split(':')
  const value = rest.join(':')
  if (value) {
    switch (rawField) {
      case 'from': return includes(email.sender, value)
      case 'to': return includes(email.recipient, value)
      case 'subject': return includes(email.subject, value)
      case 'body': return includes(email.body, value)
      case 'filename':
      case 'attachment':
        return attachments.some(a => includes(a.filename, value))
    }
  }

  return [
    email.sender,
    email.recipient,
    email.subject,
    email.body,
    ...attachments.map(a => a.filename),
  ].some(field => includes(field, term))
}

function includes(value: string | undefined, term: string): boolean {
  return (value ?? '').toLowerCase().includes(term)
}
