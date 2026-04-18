import type Fylo from '@delma/fylo'
import type { DomainMigration, StoredEmail } from '../types.ts'
import { listDomainMigrations } from '../db/domain-migrations.ts'

export async function presentEmailsForDomainMigrations(
  fylo: Fylo,
  emails: StoredEmail[],
): Promise<StoredEmail[]> {
  const migrations = await activeDomainMigrations(fylo)
  if (migrations.length === 0) return emails
  return emails.map(email => presentEmailWithMigrations(email, migrations))
}

export async function presentEmailForDomainMigrations(
  fylo: Fylo,
  email: StoredEmail,
): Promise<StoredEmail> {
  return presentEmailWithMigrations(email, await activeDomainMigrations(fylo))
}

function presentEmailWithMigrations(
  email: StoredEmail,
  migrations: DomainMigration[],
): StoredEmail {
  const migration = migrations.find(candidate => candidate.fromDomain === email.domain)
  if (!migration) return email

  const [local, domain] = email.recipient.toLowerCase().split('@')
  if (!local || domain !== migration.fromDomain) return email

  return {
    ...email,
    originalRecipient: email.originalRecipient ?? email.recipient,
    recipient: `${local}@${migration.toDomain}`,
  }
}

async function activeDomainMigrations(fylo: Fylo): Promise<DomainMigration[]> {
  return (await listDomainMigrations(fylo)).filter(migration => Boolean(migration.appliedAt))
}
