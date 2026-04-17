#!/usr/bin/env bun
import { createDb } from '../src/db/index.ts'
import { findDomainEntry, putDomain } from '../src/db/domains.ts'
import { putUser } from '../src/db/users.ts'
import { normalizeDomain, normalizeEmailAddress } from '../src/shared/security.ts'

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    return [key, rest.join('=') || 'true']
  })
)

const email = normalizeEmailAddress(String(args.email ?? process.env.HERMES_ADMIN_EMAIL ?? ''))
const domain = normalizeDomain(String(args.domain ?? process.env.HERMES_ADMIN_DOMAIN ?? ''))
const phone = String(args.phone ?? process.env.HERMES_ADMIN_PHONE ?? '').trim()

if (!email || !domain || !phone) {
  console.error('Usage: bun scripts/create-admin.mjs --email=admin@example.com --phone=+14165550100 --domain=example.com')
  process.exit(1)
}

const fylo = await createDb()
const [, existingDomain] = await findDomainEntry(fylo, domain)
if (!existingDomain) {
  await putDomain(fylo, {
    domain,
    inboundEnabled: true,
    routes: [{ id: `store-${domain}`, match: `*@${domain}`, action: { type: 'store' }, enabled: true }],
  })
}

await putUser(fylo, {
  email,
  phones: [phone],
  domains: [domain],
  role: 'admin',
})

console.log(JSON.stringify({ email, domain, role: 'admin', domainCreated: !existingDomain }, null, 2))
