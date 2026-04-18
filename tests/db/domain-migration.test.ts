import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDb } from '../../src/db/index.ts'
import { putDomain, findDomainEntry } from '../../src/db/domains.ts'
import { listDomainMigrations } from '../../src/db/domain-migrations.ts'
import { putEmail, findEmailById } from '../../src/db/emails.ts'
import { putUser, findUserByEmail } from '../../src/db/users.ts'
import { putDevice, listDevices } from '../../src/db/mfa.ts'
import { upsertPushSubscription, listPushSubscriptions } from '../../src/db/push.ts'
import { presentEmailForDomainMigrations } from '../../src/shared/domain-migration.ts'
import type Fylo from '@delma/fylo'

let fylo: Fylo
let testRoot: string

beforeEach(async () => {
  testRoot = mkdtempSync(join(tmpdir(), 'hermes-domain-migration-'))
  fylo = await createDb(testRoot)
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe('domain:migrate', () => {
  it('promotes old-domain users to the new suffix while preserving aliases and owned records', async () => {
    await putDomain(fylo, {
      domain: 'old.example',
      inboundEnabled: true,
      routes: [{ id: 'store-old.example', match: '*@old.example', action: { type: 'store' }, enabled: true }],
    })
    await putUser(fylo, {
      email: 'alice@old.example',
      phones: ['+15551234567'],
      domains: ['old.example'],
      role: 'admin',
    })
    await putDevice(fylo, {
      id: 'device-1',
      userEmail: 'alice@old.example',
      name: 'Phone',
      secret: 'secret',
      createdAt: new Date().toISOString(),
    })
    await upsertPushSubscription(fylo, {
      userEmail: 'alice@old.example',
      endpoint: 'https://push.example.test/alice',
      keys: { p256dh: 'p256dh', auth: 'auth' },
    })

    const dryRun = Bun.spawnSync([
      'bun',
      'scripts/migrate-domain.mjs',
      '--from=old.example',
      '--to=new.example',
    ], {
      cwd: join(import.meta.dir, '..', '..'),
      env: { ...process.env, FYLO_ROOT: testRoot },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(dryRun.exitCode).toBe(0)
    expect(JSON.parse(dryRun.stdout.toString()).dryRun).toBe(true)

    const applied = Bun.spawnSync([
      'bun',
      'scripts/migrate-domain.mjs',
      '--from=old.example',
      '--to=new.example',
      '--apply',
    ], {
      cwd: join(import.meta.dir, '..', '..'),
      env: { ...process.env, FYLO_ROOT: testRoot },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(applied.exitCode).toBe(0)

    const [, newDomain] = await findDomainEntry(fylo, 'new.example')
    expect(newDomain).not.toBeNull()
    expect(newDomain!.routes[0].match).toBe('*@new.example')

    const [, byNewEmail] = await findUserByEmail(fylo, 'alice@new.example')
    expect(byNewEmail).not.toBeNull()
    expect(byNewEmail!.email).toBe('alice@new.example')
    expect(byNewEmail!.aliases).toContain('alice@old.example')
    expect(byNewEmail!.domains).toContain('old.example')
    expect(byNewEmail!.domains).toContain('new.example')

    const [, byOldAlias] = await findUserByEmail(fylo, 'alice@old.example')
    expect(byOldAlias!.email).toBe('alice@new.example')

    expect(await listDevices(fylo, 'alice@old.example')).toHaveLength(0)
    expect(await listDevices(fylo, 'alice@new.example')).toHaveLength(1)
    expect(await listPushSubscriptions(fylo, 'alice@old.example')).toHaveLength(0)
    expect(await listPushSubscriptions(fylo, 'alice@new.example')).toHaveLength(1)

    const migrations = await listDomainMigrations(fylo)
    expect(migrations.some(migration => migration.fromDomain === 'old.example' && migration.toDomain === 'new.example')).toBe(true)

    await putEmail(fylo, {
      id: 'old-mail-1',
      domain: 'old.example',
      recipient: 'alice@old.example',
      sender: 'sender@example.test',
      subject: 'Before migration',
      body: 'Historical mail',
      folder: 'inbox',
      read: false,
      starred: false,
      receivedAt: new Date().toISOString(),
      processed: true,
    })
    const [, storedEmail] = await findEmailById(fylo, 'old-mail-1')
    const presented = await presentEmailForDomainMigrations(fylo, storedEmail!)
    expect(presented.recipient).toBe('alice@new.example')
    expect(presented.originalRecipient).toBe('alice@old.example')
  })
})
