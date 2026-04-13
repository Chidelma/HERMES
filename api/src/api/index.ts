import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { randomBytes } from 'node:crypto'
import { getFylo, Collections } from '../shared/fylo'
import { verifyJwt } from '../shared/jwt'
import { CORS, ok, badRequest, notFound, unauthorized, forbidden, getSecret } from '../shared/http'
import { parseInboxRule } from '../shared/rules'
import { generateTotpSecret, totpProvisionUri } from '../shared/totp'
import { getUserPhones } from '../shared/types'
import type { DomainConfig, RouteRule, StoredEmail, User, InboxRule, MfaDevice, SetupSession } from '../shared/types'

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' }
  }

  const secret = await getSecret()
  const authHeader = event.headers['Authorization'] ?? event.headers['authorization'] ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const claims = token ? verifyJwt(token, secret) : null
  if (!claims) return unauthorized()

  const { httpMethod, path, body } = event
  const fylo = await getFylo()

  // ── Inbox ───────────────────────────────────────────────────────────────

  // GET /inbox
  if (httpMethod === 'GET' && path === '/inbox') {
    const results: Record<string, StoredEmail> = {}
    for await (const doc of fylo.findDocs(Collections.EMAILS, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    const emails = Object.values(results)
      .filter(e => claims.domains.includes(e.domain))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    return ok(emails)
  }

  // GET /inbox/:id
  const emailMatch = path.match(/^\/inbox\/([^/]+)$/)
  if (httpMethod === 'GET' && emailMatch) {
    const id = decodeURIComponent(emailMatch[1])
    const results: Record<string, StoredEmail> = {}
    for await (const doc of fylo.findDocs(Collections.EMAILS, {
      $ops: [{ id: { $eq: id } }],
    }).collect()) {
      Object.assign(results, doc)
    }
    const entry = Object.entries(results)[0]
    if (!entry) return notFound('Email not found')
    const [, email] = entry
    if (!claims.domains.includes(email.domain)) return forbidden()
    return ok(email)
  }

  // DELETE /inbox/:id
  if (httpMethod === 'DELETE' && emailMatch) {
    const id = decodeURIComponent(emailMatch[1])
    const results: Record<string, StoredEmail> = {}
    for await (const doc of fylo.findDocs(Collections.EMAILS, {
      $ops: [{ id: { $eq: id } }],
    }).collect()) {
      Object.assign(results, doc)
    }
    const entry = Object.entries(results)[0]
    if (!entry) return notFound('Email not found')
    const [docId, email] = entry
    if (!claims.domains.includes(email.domain)) return forbidden()
    await fylo.delDoc(Collections.EMAILS, docId)
    return ok({ deleted: id })
  }

  // ── Domains ─────────────────────────────────────────────────────────────

  if (httpMethod === 'GET' && path === '/domains') {
    const results: Record<string, any> = {}
    for await (const doc of fylo.findDocs(Collections.DOMAINS, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    const configs: DomainConfig[] = Object.values(results)
      .filter(d => claims.domains.includes(d.domain))
      .map(raw => ({ ...raw, routes: typeof raw.routes === 'string' ? JSON.parse(raw.routes) : (raw.routes ?? []) }))
    return ok(configs)
  }

  if (httpMethod === 'POST' && path === '/domains') {
    if (claims.role !== 'admin') return forbidden()
    if (!body) return badRequest('Missing body')
    const config: Omit<DomainConfig, 'identityArn'> & { identityArn?: string } = JSON.parse(body)
    const id = await fylo.putData(Collections.DOMAINS, {
      ...config,
      identityArn: config.identityArn ?? '',
      routes: JSON.stringify(config.routes ?? []),
    })
    return ok({ id })
  }

  const routesMatch = path.match(/^\/domains\/([^/]+)\/routes$/)
  if (httpMethod === 'GET' && routesMatch) {
    const domain = decodeURIComponent(routesMatch[1])
    if (!claims.domains.includes(domain)) return forbidden()
    const config = await getDomain(fylo, domain)
    if (!config) return notFound('Domain not found')
    return ok(config.routes)
  }

  const routeMatch = path.match(/^\/domains\/([^/]+)\/routes\/([^/]+)$/)
  if (httpMethod === 'PUT' && routeMatch) {
    if (claims.role !== 'admin') return forbidden()
    const domain = decodeURIComponent(routeMatch[1])
    const ruleId = decodeURIComponent(routeMatch[2])
    if (!claims.domains.includes(domain)) return forbidden()
    if (!body) return badRequest('Missing body')
    const rule: RouteRule = JSON.parse(body)
    const [docId, config] = await getDomainEntry(fylo, domain)
    if (!docId || !config) return notFound('Domain not found')
    const updatedRoutes = [...config.routes.filter(r => r.id !== ruleId), { ...rule, id: ruleId }]
    await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: JSON.stringify(updatedRoutes) } })
    return ok({ updated: ruleId })
  }

  if (httpMethod === 'DELETE' && routeMatch) {
    if (claims.role !== 'admin') return forbidden()
    const domain = decodeURIComponent(routeMatch[1])
    const ruleId = decodeURIComponent(routeMatch[2])
    if (!claims.domains.includes(domain)) return forbidden()
    const [docId, config] = await getDomainEntry(fylo, domain)
    if (!docId || !config) return notFound('Domain not found')
    const updatedRoutes = config.routes.filter(r => r.id !== ruleId)
    await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: JSON.stringify(updatedRoutes) } })
    return ok({ deleted: ruleId })
  }

  // ── Users (admin only) ──────────────────────────────────────────────────

  if (httpMethod === 'GET' && path === '/users') {
    if (claims.role !== 'admin') return forbidden()
    const results: Record<string, any> = {}
    for await (const doc of fylo.findDocs(Collections.USERS, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    return ok(Object.entries(results).map(([id, u]) => ({
      id,
      email: u.email,
      phones: getUserPhones(u),
      domains: u.domains,
      role: u.role,
    })))
  }

  if (httpMethod === 'POST' && path === '/users') {
    if (claims.role !== 'admin') return forbidden()
    if (!body) return badRequest('Missing body')
    const user: User = JSON.parse(body)
    if (!user.email || !user.phones?.length || !user.domains?.length) return badRequest('email, phones, and domains required')
    const id = await fylo.putData(Collections.USERS, { ...user, email: user.email.toLowerCase() })
    return ok({ id })
  }

  const userMatch = path.match(/^\/users\/([^/]+)$/)
  if (httpMethod === 'DELETE' && userMatch) {
    if (claims.role !== 'admin') return forbidden()
    const id = decodeURIComponent(userMatch[1])
    await fylo.delDoc(Collections.USERS, id)
    return ok({ deleted: id })
  }

  // ── Inbox rules ─────────────────────────────────────────────────────────

  if (httpMethod === 'GET' && path === '/rules') {
    const results: Record<string, any> = {}
    for await (const doc of fylo.findDocs(Collections.INBOX_RULES, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    const rules = Object.entries(results)
      .filter(([, r]) => claims.domains.includes(r.domain))
      .map(([id, raw]) => ({ id, ...parseInboxRule(raw) }))
    return ok(rules)
  }

  if (httpMethod === 'POST' && path === '/rules') {
    if (claims.role !== 'admin') return forbidden()
    if (!body) return badRequest('Missing body')
    const input: Omit<InboxRule, 'id'> = JSON.parse(body)
    if (!input.name) return badRequest('name required')
    if (!input.domain || !claims.domains.includes(input.domain)) return forbidden()
    const ruleId = randomBytes(16).toString('hex')
    const id = await fylo.putData(Collections.INBOX_RULES, {
      id: ruleId,
      domain: input.domain,
      name: input.name,
      enabled: input.enabled ?? true,
      conditionMatch: input.conditionMatch ?? 'all',
      conditions: JSON.stringify(input.conditions ?? []),
      actions: JSON.stringify(input.actions ?? []),
    })
    return ok({ id })
  }

  const ruleMatch = path.match(/^\/rules\/([^/]+)$/)

  if (httpMethod === 'PUT' && ruleMatch) {
    if (claims.role !== 'admin') return forbidden()
    const ruleId = decodeURIComponent(ruleMatch[1])
    if (!body) return badRequest('Missing body')
    const [docId, existing] = await getRuleEntry(fylo, ruleId)
    if (!docId || !existing) return notFound('Rule not found')
    if (!claims.domains.includes(existing.domain)) return forbidden()
    const input: Partial<InboxRule> = JSON.parse(body)
    await fylo.patchDoc(Collections.INBOX_RULES, {
      [docId]: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.conditionMatch !== undefined && { conditionMatch: input.conditionMatch }),
        ...(input.conditions !== undefined && { conditions: JSON.stringify(input.conditions) }),
        ...(input.actions !== undefined && { actions: JSON.stringify(input.actions) }),
      },
    })
    return ok({ updated: ruleId })
  }

  if (httpMethod === 'DELETE' && ruleMatch) {
    if (claims.role !== 'admin') return forbidden()
    const ruleId = decodeURIComponent(ruleMatch[1])
    const [docId, existing] = await getRuleEntry(fylo, ruleId)
    if (!docId || !existing) return notFound('Rule not found')
    if (!claims.domains.includes(existing.domain)) return forbidden()
    await fylo.delDoc(Collections.INBOX_RULES, docId)
    return ok({ deleted: ruleId })
  }

  // ── Suppressed ──────────────────────────────────────────────────────────

  if (httpMethod === 'GET' && path === '/suppressed') {
    if (claims.role !== 'admin') return forbidden()
    const results: Record<string, unknown> = {}
    for await (const doc of fylo.findDocs(Collections.SUPPRESSED, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    return ok(Object.values(results))
  }

  const suppressedMatch = path.match(/^\/suppressed\/(.+)$/)
  if (httpMethod === 'DELETE' && suppressedMatch) {
    if (claims.role !== 'admin') return forbidden()
    const address = decodeURIComponent(suppressedMatch[1])
    const results: Record<string, { address: string }> = {}
    for await (const doc of fylo.findDocs(Collections.SUPPRESSED, {
      $ops: [{ address: { $eq: address } }],
    }).collect()) {
      Object.assign(results, doc)
    }
    for (const id of Object.keys(results)) {
      await fylo.delDoc(Collections.SUPPRESSED, id)
    }
    return ok({ removed: address })
  }

  // ── MFA device management ────────────────────────────────────────────────
  // Authenticated users manage their own devices; admins see only their own.

  if (httpMethod === 'GET' && path === '/mfa/devices') {
    const results: Record<string, MfaDevice> = {}
    for await (const doc of fylo.findDocs(Collections.MFA_DEVICES, {
      $ops: [{ userEmail: { $eq: claims.email } }],
    }).collect()) {
      Object.assign(results, doc)
    }
    const devices = Object.entries(results).map(([id, d]) => ({
      id,
      name: d.name,
      createdAt: d.createdAt,
    }))
    return ok(devices)
  }

  // POST /mfa/provision — generate a setup session for adding a new device.
  // Returns the TOTP secret and provisioning URI; the client then calls
  // POST /auth/mfa/setup (auth Lambda) with the setupToken to register.
  if (httpMethod === 'POST' && path === '/mfa/provision') {
    const totpSecret = generateTotpSecret()
    const totpUri = totpProvisionUri(claims.email, totpSecret)
    const setupToken = randomBytes(32).toString('hex')
    await fylo.putData(Collections.SETUP_SESSIONS, {
      id: setupToken,
      email: claims.email,
      totpSecret,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    } satisfies SetupSession)
    return ok({ setupToken, totpSecret, totpUri })
  }

  const mfaDeviceMatch = path.match(/^\/mfa\/devices\/([^/]+)$/)
  if (httpMethod === 'DELETE' && mfaDeviceMatch) {
    const deviceId = decodeURIComponent(mfaDeviceMatch[1])
    const results: Record<string, MfaDevice> = {}
    for await (const doc of fylo.findDocs(Collections.MFA_DEVICES, {
      $ops: [{ id: { $eq: deviceId } }],
    }).collect()) {
      Object.assign(results, doc)
    }
    const entry = Object.entries(results)[0]
    if (!entry) return notFound('Device not found')
    const [docId, device] = entry
    if (device.userEmail !== claims.email) return forbidden()
    await fylo.delDoc(Collections.MFA_DEVICES, docId)
    return ok({ deleted: deviceId })
  }

  return notFound('Not found')
}

async function getDomain(fylo: Awaited<ReturnType<typeof getFylo>>, domain: string): Promise<DomainConfig | null> {
  const [, config] = await getDomainEntry(fylo, domain)
  return config
}

async function getDomainEntry(fylo: Awaited<ReturnType<typeof getFylo>>, domain: string): Promise<[string | null, DomainConfig | null]> {
  const results: Record<string, any> = {}
  for await (const doc of fylo.findDocs(Collections.DOMAINS, {
    $ops: [{ domain: { $eq: domain } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const entries = Object.entries(results)
  if (entries.length === 0) return [null, null]
  const [id, raw] = entries[0]
  const config: DomainConfig = { ...raw, routes: typeof raw.routes === 'string' ? JSON.parse(raw.routes) : (raw.routes ?? []) }
  return [id, config]
}

async function getRuleEntry(fylo: Awaited<ReturnType<typeof getFylo>>, ruleId: string): Promise<[string | null, InboxRule | null]> {
  const results: Record<string, any> = {}
  for await (const doc of fylo.findDocs(Collections.INBOX_RULES, {
    $ops: [{ id: { $eq: ruleId } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const entries = Object.entries(results)
  if (entries.length === 0) return [null, null]
  const [docId, raw] = entries[0]
  return [docId, { id: ruleId, ...parseInboxRule(raw) } as InboxRule]
}
