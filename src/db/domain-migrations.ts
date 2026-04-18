import type Fylo from '@delma/fylo'
import type { DomainMigration } from '../types.ts'
import { Collections, collect } from './index.ts'

export async function listDomainMigrations(fylo: Fylo): Promise<Array<DomainMigration & { docId: string }>> {
  const docs = await collect<DomainMigration>(
    fylo.findDocs<DomainMigration>(Collections.DOMAIN_MIGRATIONS, { $ops: [] }).collect()
  )
  return Object.entries(docs).map(([docId, migration]) => ({ docId, ...migration }))
}

export async function findDomainMigration(
  fylo: Fylo,
  fromDomain: string,
  toDomain: string,
): Promise<[string | null, DomainMigration | null]> {
  const docs = await collect<DomainMigration>(
    fylo.findDocs<DomainMigration>(Collections.DOMAIN_MIGRATIONS, {
      $ops: [
        { fromDomain: { $eq: fromDomain } },
        { toDomain: { $eq: toDomain } },
      ] as any,
    }).collect()
  )
  const entry = Object.entries(docs)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

export async function putDomainMigration(fylo: Fylo, migration: DomainMigration): Promise<string> {
  const [docId] = await findDomainMigration(fylo, migration.fromDomain, migration.toDomain)
  if (docId) {
    await fylo.patchDoc(Collections.DOMAIN_MIGRATIONS, { [docId]: migration })
    return docId
  }
  return await fylo.putData(Collections.DOMAIN_MIGRATIONS, migration)
}
