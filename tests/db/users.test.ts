import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../../src/db/index.ts'
import {
  listUsers,
  findUserByEmail,
  findUserByEmailAndPhone,
  putUser,
  deleteUser,
} from '../../src/db/users.ts'
import type Fylo from '@delma/fylo'
import type { User } from '../../src/types.ts'

let fylo: Fylo
let testRoot: string

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'hermes-test-'))
  fylo = await createDb(testRoot)
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

const alice: User = {
  email: 'alice@example.com',
  phones: ['+15551234567'],
  domains: ['example.com'],
  role: 'admin',
}

const bob: User = {
  email: 'bob@example.com',
  phones: ['+15559876543'],
  domains: ['example.com'],
  role: 'viewer',
}

describe('putUser / listUsers', () => {
  it('stores and retrieves a user', async () => {
    await putUser(fylo, alice)
    const users = await listUsers(fylo)
    expect(users).toHaveLength(1)
    expect(users[0].email).toBe('alice@example.com')
    expect(users[0].phones).toEqual(['+15551234567'])
    expect(users[0].role).toBe('admin')
  })

  it('normalises email to lowercase on insert', async () => {
    await putUser(fylo, { ...alice, email: 'ALICE@Example.COM' })
    const [, user] = await findUserByEmail(fylo, 'alice@example.com')
    expect(user).not.toBeNull()
    expect(user!.email).toBe('alice@example.com')
  })

  it('stores multiple users', async () => {
    await putUser(fylo, alice)
    await putUser(fylo, bob)
    const users = await listUsers(fylo)
    expect(users).toHaveLength(2)
  })
})

describe('findUserByEmail', () => {
  it('returns the user when found', async () => {
    await putUser(fylo, alice)
    const [docId, user] = await findUserByEmail(fylo, 'alice@example.com')
    expect(docId).not.toBeNull()
    expect(user).not.toBeNull()
    expect(user!.email).toBe('alice@example.com')
  })

  it('returns [null, null] when not found', async () => {
    const [docId, user] = await findUserByEmail(fylo, 'nobody@example.com')
    expect(docId).toBeNull()
    expect(user).toBeNull()
  })

  it('finds user case-insensitively', async () => {
    await putUser(fylo, alice)
    const [, user] = await findUserByEmail(fylo, 'ALICE@EXAMPLE.COM')
    expect(user).not.toBeNull()
  })
})

describe('findUserByEmailAndPhone', () => {
  it('finds user matching both email and phone', async () => {
    await putUser(fylo, alice)
    const [docId, user] = await findUserByEmailAndPhone(fylo, alice.email, alice.phones[0])
    expect(docId).not.toBeNull()
    expect(user!.email).toBe('alice@example.com')
  })

  it('returns null when phone does not match', async () => {
    await putUser(fylo, alice)
    const [docId, user] = await findUserByEmailAndPhone(fylo, alice.email, '+19999999999')
    expect(docId).toBeNull()
    expect(user).toBeNull()
  })

  it('returns null when email does not match', async () => {
    await putUser(fylo, alice)
    const [docId, user] = await findUserByEmailAndPhone(fylo, 'nobody@example.com', alice.phones[0])
    expect(docId).toBeNull()
    expect(user).toBeNull()
  })
})

describe('deleteUser', () => {
  it('removes the user', async () => {
    await putUser(fylo, alice)
    const [docId] = await findUserByEmail(fylo, alice.email)
    expect(docId).not.toBeNull()

    await deleteUser(fylo, docId!)
    const users = await listUsers(fylo)
    expect(users).toHaveLength(0)
  })

  it('does not affect other users', async () => {
    await putUser(fylo, alice)
    await putUser(fylo, bob)
    const [aliceDocId] = await findUserByEmail(fylo, alice.email)

    await deleteUser(fylo, aliceDocId!)
    const [, remaining] = await findUserByEmail(fylo, bob.email)
    expect(remaining).not.toBeNull()
  })
})
