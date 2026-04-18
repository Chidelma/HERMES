#!/usr/bin/env bun
import { randomUUID } from 'node:crypto'
import { createDb, Collections, collect } from '../src/db/index.ts'
import { findDomainEntry, putDomain } from '../src/db/domains.ts'
import { putDomainMigration } from '../src/db/domain-migrations.ts'
import { listRules, findRuleById, putRule } from '../src/db/rules.ts'
import { listUsers, findUserByEmail, normalizeUser } from '../src/db/users.ts'
import { normalizeDomain } from '../src/shared/security.ts'

const args = parseArgs(process.argv.slice(2))
const fromDomain = normalizeDomain(String(args.from ?? args._[0] ?? ''))
const toDomain = normalizeDomain(String(args.to ?? args._[1] ?? ''))
const apply = args.apply === true || args.apply === 'true'
const dryRun = !apply

if (!fromDomain || !toDomain || fromDomain === toDomain) {
  console.error('Usage: bun scripts/migrate-domain.mjs --from=old.example --to=new.example [--apply]')
  process.exit(1)
}

const fylo = await createDb()
const [, fromConfig] = await findDomainEntry(fylo, fromDomain)
const [, existingToConfig] = await findDomainEntry(fylo, toDomain)
if (!fromConfig) {
  console.error(JSON.stringify({ error: `Source domain not found: ${fromDomain}` }, null, 2))
  process.exit(1)
}

const users = await listUsers(fylo)
const primaryMoves = users
  .filter(user => domainOf(user.email) === fromDomain)
  .map(user => ({
    ...user,
    oldEmail: user.email,
    newEmail: `${localPart(user.email)}@${toDomain}`,
  }))

const conflicts = []
for (const move of primaryMoves) {
  const [conflictDocId, conflictUser] = await findUserByEmail(fylo, move.newEmail)
  if (conflictDocId && conflictDocId !== move.docId) {
    conflicts.push({
      oldEmail: move.oldEmail,
      newEmail: move.newEmail,
      conflictEmail: conflictUser?.email,
    })
  }
}

if (conflicts.length > 0) {
  console.error(JSON.stringify({ error: 'Migration has conflicting destination users', conflicts }, null, 2))
  process.exit(1)
}

const domainAction = existingToConfig ? 'kept-existing' : 'created-from-source'
const affectedDomainUsers = users
  .filter(user => user.domains.includes(fromDomain) && !primaryMoves.some(move => move.docId === user.docId))
  .map(user => user.email)
const rulesToCopy = await listRules(fylo, [fromDomain])
const plannedRules = []

for (const rule of rulesToCopy) {
  const id = `${rule.id}-migrated-${toDomain}`
  const [existingRuleDocId] = await findRuleById(fylo, id)
  plannedRules.push({
    from: rule.id,
    to: id,
    action: existingRuleDocId ? 'kept-existing' : 'created-from-source',
  })
}

const plan = {
  dryRun,
  fromDomain,
  toDomain,
  domain: domainAction,
  usersPromoted: primaryMoves.map(move => ({ from: move.oldEmail, to: move.newEmail })),
  usersGrantedNewDomain: affectedDomainUsers,
  inboxRules: plannedRules,
}

if (dryRun) {
  console.log(JSON.stringify(plan, null, 2))
  process.exit(0)
}

if (!existingToConfig) {
  await putDomain(fylo, {
    ...fromConfig,
    domain: toDomain,
    routes: fromConfig.routes.map(route => rewriteRouteForDomain(route, fromDomain, toDomain)),
  })
}

for (const rule of rulesToCopy) {
  const id = `${rule.id}-migrated-${toDomain}`
  const [existingRuleDocId] = await findRuleById(fylo, id)
  if (existingRuleDocId) continue
  await putRule(fylo, {
    ...rule,
    id,
    domain: toDomain,
  })
}

for (const move of primaryMoves) {
  const updated = normalizeUser({
    ...move,
    email: move.newEmail,
    aliases: [...(move.aliases ?? []), move.oldEmail],
    domains: [...move.domains, fromDomain, toDomain],
  })
  const { docId, oldEmail, newEmail, ...user } = updated
  void docId
  void oldEmail
  void newEmail
  await fylo.patchDoc(Collections.USERS, { [move.docId]: user })
  await rewriteUserEmailReferences(fylo, move.oldEmail, move.newEmail)
}

for (const user of users) {
  if (!user.domains.includes(fromDomain)) continue
  if (primaryMoves.some(move => move.docId === user.docId)) continue
  const updated = normalizeUser({
    ...user,
    domains: [...user.domains, toDomain],
  })
  const { docId, ...patch } = updated
  await fylo.patchDoc(Collections.USERS, { [docId]: patch })
}

await putDomainMigration(fylo, {
  id: `domain-migration:${fromDomain}->${toDomain}`,
  fromDomain,
  toDomain,
  mode: 'alias',
  localPartStrategy: 'preserve',
  createdAt: new Date().toISOString(),
  appliedAt: new Date().toISOString(),
})

console.log(JSON.stringify({ ...plan, dryRun: false, applied: true }, null, 2))

function parseArgs(argv) {
  const parsed = { _: [] }
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      parsed._.push(arg)
      continue
    }
    const [key, ...rest] = arg.slice(2).split('=')
    parsed[key] = rest.length ? rest.join('=') : true
  }
  return parsed
}

function domainOf(email) {
  return email.split('@')[1]?.toLowerCase() ?? ''
}

function localPart(email) {
  return email.split('@')[0].toLowerCase()
}

function rewriteRouteForDomain(route, fromDomain, toDomain) {
  return {
    ...route,
    id: route.id === `store-${fromDomain}` ? `store-${toDomain}` : route.id,
    match: rewriteAddressPattern(route.match, fromDomain, toDomain),
  }
}

function rewriteAddressPattern(value, fromDomain, toDomain) {
  if (value === '*') return value
  if (value === `*@${fromDomain}`) return `*@${toDomain}`
  if (value.endsWith(`@${fromDomain}`)) return `${value.slice(0, -fromDomain.length)}${toDomain}`
  return value
}

async function rewriteUserEmailReferences(fylo, oldEmail, newEmail) {
  await rewriteCollectionField(fylo, Collections.MFA_DEVICES, 'userEmail', oldEmail, newEmail)
  await rewriteCollectionField(fylo, Collections.MFA_SESSIONS, 'email', oldEmail, newEmail)
  await rewriteCollectionField(fylo, Collections.SETUP_SESSIONS, 'email', oldEmail, newEmail)
  await rewriteCollectionField(fylo, Collections.OTP_SESSIONS, 'email', oldEmail, newEmail)
  await rewriteCollectionField(fylo, Collections.PUSH_SUBSCRIPTIONS, 'userEmail', oldEmail, newEmail)
}

async function rewriteCollectionField(fylo, collection, field, oldValue, newValue) {
  const docs = await collect(
    fylo.findDocs(collection, {
      $ops: [{ [field]: { $eq: oldValue } }],
    }).collect()
  )
  await Promise.all(
    Object.keys(docs).map(docId => fylo.patchDoc(collection, { [docId]: { [field]: newValue } }))
  )
}
