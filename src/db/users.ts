import type Fylo from '@delma/fylo'
import type { User } from '../types.ts'
import { Collections, collect } from './index.ts'

/** Returns all users. */
export async function listUsers(fylo: Fylo): Promise<Array<User & { docId: string }>> {
  const docs = await collect<User>(
    fylo.findDocs<User>(Collections.USERS, { $ops: [] }).collect()
  )
  return Object.entries(docs).map(([docId, u]) => ({ docId, ...u }))
}

/**
 * Finds a user by email address (case-insensitive). Returns `[docId, user]`.
 * Returns `[null, null]` when not found.
 */
export async function findUserByEmail(
  fylo: Fylo,
  email: string
): Promise<[string | null, User | null]> {
  const docs = await collect<User>(
    fylo.findDocs<User>(Collections.USERS, {
      $ops: [{ email: { $eq: email.toLowerCase() } } as any],
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
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
  const docs = await collect<User>(
    fylo.findDocs<User>(Collections.USERS, {
      $ops: [{ email: { $eq: email.toLowerCase() } } as any],
    }).collect()
  )
  const entry = Object.entries(docs).find(([, u]) => u.phones.includes(phone))
  return entry ? [entry[0], entry[1]] : [null, null]
}

/** Stores a new user. Normalises email to lowercase. Returns the Fylo document ID. */
export async function putUser(fylo: Fylo, user: User): Promise<string> {
  return await fylo.putData(Collections.USERS, { ...user, email: user.email.toLowerCase() })
}

/** Permanently removes a user document. */
export async function deleteUser(fylo: Fylo, docId: string): Promise<void> {
  await fylo.delDoc(Collections.USERS, docId)
}
