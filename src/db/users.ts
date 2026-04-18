import { randomUUID } from 'node:crypto'
import type Fylo from '@delma/fylo'
import type { User } from '../types.ts'
import { Collections, collect } from './index.ts'
import { normalizeEmailAddress, normalizeDomain } from '../shared/security.ts'

/** Returns all users. */
export async function listUsers(fylo: Fylo): Promise<Array<User & { docId: string }>> {
  const docs = await collect<User>(
    fylo.findDocs<User>(Collections.USERS, { $ops: [] }).collect()
  )
  return Object.entries(docs).map(([docId, u]) => ({ docId, ...normalizeUser(u) }))
}

/**
 * Finds a user by email address (case-insensitive). Returns `[docId, user]`.
 * Returns `[null, null]` when not found.
 */
export async function findUserByEmail(
  fylo: Fylo,
  email: string
): Promise<[string | null, User | null]> {
  const normalizedEmail = normalizeEmailAddress(email)
  if (!normalizedEmail) return [null, null]

  const docs = await collect<User>(
    fylo.findDocs<User>(Collections.USERS, {
      $ops: [{ email: { $eq: normalizedEmail } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  if (entry) return [entry[0], normalizeUser(entry[1])]

  const users = await listUsers(fylo)
  const aliased = users.find(user => user.aliases?.includes(normalizedEmail))
  return aliased ? [aliased.docId, stripDocId(aliased)] : [null, null]
}

/**
 * Finds a user matching both email and phone (exact E.164 match).
 * Returns `[docId, user]`. Returns `[null, null]` when not found.
 */
export async function findUserByEmailAndPhone(
  fylo: Fylo,
  email: string,
  phone: string
): Promise<[string | null, User | null]> {
  const [docId, user] = await findUserByEmail(fylo, email)
  if (!docId || !user || !user.phones.includes(phone)) return [null, null]
  return [docId, user]
}

/** Stores a new user. Normalises email to lowercase. Returns the Fylo document ID. */
export async function putUser(fylo: Fylo, user: User): Promise<string> {
  return await fylo.putData(Collections.USERS, normalizeUser(user))
}

/** Applies a partial update to a user document. */
export async function updateUser(fylo: Fylo, docId: string, patch: Partial<User>): Promise<void> {
  const [, existing] = await findUserByEmail(fylo, patch.email ?? '')
  if (patch.email && existing) {
    await fylo.patchDoc(Collections.USERS, { [docId]: normalizeUser({ ...existing, ...patch }) })
    return
  }
  await fylo.patchDoc(Collections.USERS, { [docId]: normalizePartialUser(patch) })
}

/** Permanently removes a user document. */
export async function deleteUser(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.USERS, docId)
}

export function normalizeUser(user: User): User {
  const email = normalizeEmailAddress(user.email) ?? user.email.trim().toLowerCase()
  const aliases = dedupe(
    (user.aliases ?? [])
      .map(alias => normalizeEmailAddress(alias))
      .filter((alias): alias is string => Boolean(alias))
      .filter(alias => alias !== email)
  )
  const domains = dedupe(
    user.domains
      .map(domain => normalizeDomain(domain))
      .filter((domain): domain is string => Boolean(domain))
  )

  return {
    ...user,
    id: user.id || randomUUID(),
    email,
    aliases,
    domains,
  }
}

function normalizePartialUser(user: Partial<User>): Partial<User> {
  return {
    ...user,
    email: user.email ? normalizeEmailAddress(user.email) ?? user.email.trim().toLowerCase() : undefined,
    aliases: user.aliases ? dedupe(user.aliases.map(alias => normalizeEmailAddress(alias)).filter((alias): alias is string => Boolean(alias))) : undefined,
    domains: user.domains ? dedupe(user.domains.map(domain => normalizeDomain(domain)).filter((domain): domain is string => Boolean(domain))) : undefined,
  }
}

function stripDocId(user: User & { docId: string }): User {
  const { docId, ...rest } = user
  void docId
  return rest
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}
