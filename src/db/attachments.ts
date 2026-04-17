import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import type Fylo from '@delma/fylo'
import type { EmailAttachmentRecord, EmailAttachmentSummary } from '../types.ts'
import { Collections, collect } from './index.ts'

export interface ParsedAttachment {
  filename?: string
  contentType?: string
  content: Uint8Array
  disposition?: string
  contentId?: string
}

const DEFAULT_ATTACHMENT_DIR = '/mnt/hermes/attachments'

export function attachmentRoot(): string {
  return process.env.ATTACHMENT_ROOT
    ?? join(process.env.FYLO_ROOT ?? '/mnt/hermes', 'attachments')
    ?? DEFAULT_ATTACHMENT_DIR
}

export function toAttachmentSummary(attachment: EmailAttachmentRecord): EmailAttachmentSummary {
  const { id, filename, contentType, size, disposition, contentId } = attachment
  return { id, filename, contentType, size, disposition, contentId }
}

export async function listAttachments(
  fylo: Fylo,
  emailId: string,
): Promise<Array<EmailAttachmentRecord & { docId: string }>> {
  const docs = await collect<EmailAttachmentRecord>(
    fylo.findDocs<EmailAttachmentRecord>(Collections.ATTACHMENTS, {
      $ops: [{ emailId: { $eq: emailId } } as any],
    }).collect()
  )
  return Object.entries(docs).map(([docId, attachment]) => ({ docId, ...attachment }))
}

export async function listAttachmentSummaries(
  fylo: Fylo,
  emailId: string,
): Promise<EmailAttachmentSummary[]> {
  const attachments = await listAttachments(fylo, emailId)
  return attachments.map(toAttachmentSummary)
}

export async function listAttachmentSummariesByEmail(
  fylo: Fylo,
  allowedDomains: string[],
): Promise<Map<string, EmailAttachmentSummary[]>> {
  const docs = await collect<EmailAttachmentRecord>(
    fylo.findDocs<EmailAttachmentRecord>(Collections.ATTACHMENTS, { $ops: [] }).collect()
  )
  const grouped = new Map<string, EmailAttachmentSummary[]>()
  for (const attachment of Object.values(docs)) {
    if (!allowedDomains.includes(attachment.domain)) continue
    const summaries = grouped.get(attachment.emailId) ?? []
    summaries.push(toAttachmentSummary(attachment))
    grouped.set(attachment.emailId, summaries)
  }
  return grouped
}

export async function findAttachmentById(
  fylo: Fylo,
  id: string,
): Promise<[string | null, EmailAttachmentRecord | null]> {
  const docs = await collect<EmailAttachmentRecord>(
    fylo.findDocs<EmailAttachmentRecord>(Collections.ATTACHMENTS, {
      $ops: [{ id: { $eq: id } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

export async function saveEmailAttachments(
  fylo: Fylo,
  emailId: string,
  domain: string,
  attachments: ParsedAttachment[],
): Promise<EmailAttachmentSummary[]> {
  const saved: EmailAttachmentSummary[] = []
  if (attachments.length === 0) return saved

  const root = attachmentRoot()
  await mkdir(root, { recursive: true })

  for (const attachment of attachments) {
    const id = randomBytes(16).toString('hex')
    const filename = safeFilename(attachment.filename || `attachment-${id}`)
    const storagePath = resolve(root, emailId, `${id}-${filename}`)
    ensureInsideRoot(root, storagePath)
    await mkdir(dirname(storagePath), { recursive: true })
    await writeFile(storagePath, attachment.content)

    const record: EmailAttachmentRecord = {
      id,
      emailId,
      domain,
      filename,
      contentType: attachment.contentType || 'application/octet-stream',
      size: attachment.content.byteLength,
      disposition: attachment.disposition,
      contentId: attachment.contentId,
      storagePath,
      createdAt: new Date().toISOString(),
    }

    await fylo.putData(Collections.ATTACHMENTS, record)
    saved.push(toAttachmentSummary(record))
  }

  return saved
}

export async function readAttachmentContent(attachment: EmailAttachmentRecord): Promise<Uint8Array> {
  ensureInsideRoot(attachmentRoot(), attachment.storagePath)
  return await Bun.file(attachment.storagePath).bytes()
}

export async function deleteAttachmentsForEmail(fylo: Fylo, emailId: string): Promise<void> {
  const attachments = await listAttachments(fylo, emailId)
  await Promise.all(attachments.map(async ({ docId, storagePath }) => {
    await fylo.delDoc(Collections.ATTACHMENTS, docId)
    try {
      ensureInsideRoot(attachmentRoot(), storagePath)
      await rm(storagePath, { force: true })
    } catch {
      // Metadata deletion is the source of truth; file cleanup is best effort.
    }
  }))

  await rm(resolve(attachmentRoot(), emailId), { recursive: true, force: true })
}

function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 160) || 'attachment'
}

function ensureInsideRoot(root: string, target: string): void {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel.startsWith('..') || rel === '..' || rel.startsWith('/')) {
    throw new Error('Attachment path escapes storage root')
  }
}
