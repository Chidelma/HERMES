import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { getFylo, Collections } from '../shared/fylo'
import { verifyJwt } from '../shared/jwt'
import type { DomainConfig, RouteRule, StoredEmail, User } from '../shared/types'

const sm = new SecretsManagerClient({})

let _secret: string | null = null
async function getSecret(): Promise<string> {
  if (_secret) return _secret
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN }))
  _secret = res.SecretString!
  return _secret
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
}

function ok(data: unknown): APIGatewayProxyResult {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(data) }
}

function badRequest(message: string): APIGatewayProxyResult {
  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: message }) }
}

function notFound(message: string): APIGatewayProxyResult {
  return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: message }) }
}

function unauthorized(message = 'Unauthorized'): APIGatewayProxyResult {
  return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: message }) }
}

function forbidden(): APIGatewayProxyResult {
  return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Forbidden' }) }
}

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
    const emails = Object.entries(results)
      .filter(([, e]) => claims.domains.includes(e.domain))
      .map(([id, e]) => ({ id, ...e }))
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
    const [docId, email] = entry
    if (!claims.domains.includes(email.domain)) return forbidden()
    return ok({ id: docId, ...email })
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

  // ── Domains (admin only) ────────────────────────────────────────────────

  if (httpMethod === 'GET' && path === '/domains') {
    const results: Record<string, DomainConfig> = {}
    for await (const doc of fylo.findDocs(Collections.DOMAINS, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    const configs = Object.values(results).filter(d => claims.domains.includes(d.domain))
    return ok(configs)
  }

  if (httpMethod === 'POST' && path === '/domains') {
    if (claims.role !== 'admin') return forbidden()
    if (!body) return badRequest('Missing body')
    const config: Omit<DomainConfig, 'identityArn'> & { identityArn?: string } = JSON.parse(body)
    const id = await fylo.putData(Collections.DOMAINS, { ...config, identityArn: config.identityArn ?? '' })
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
    await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: updatedRoutes } })
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
    await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: updatedRoutes } })
    return ok({ deleted: ruleId })
  }

  // ── Users (admin only) ──────────────────────────────────────────────────

  if (httpMethod === 'GET' && path === '/users') {
    if (claims.role !== 'admin') return forbidden()
    const results: Record<string, User> = {}
    for await (const doc of fylo.findDocs(Collections.USERS, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    return ok(Object.entries(results).map(([id, u]) => ({ id, email: u.email, domains: u.domains, role: u.role })))
  }

  if (httpMethod === 'POST' && path === '/users') {
    if (claims.role !== 'admin') return forbidden()
    if (!body) return badRequest('Missing body')
    const user: User = JSON.parse(body)
    if (!user.email || !user.phone || !user.domains?.length) return badRequest('email, phone, and domains required')
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

  return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) }
}

async function getDomain(fylo: Awaited<ReturnType<typeof getFylo>>, domain: string): Promise<DomainConfig | null> {
  const [, config] = await getDomainEntry(fylo, domain)
  return config
}

async function getDomainEntry(fylo: Awaited<ReturnType<typeof getFylo>>, domain: string): Promise<[string | null, DomainConfig | null]> {
  const results: Record<string, DomainConfig> = {}
  for await (const doc of fylo.findDocs(Collections.DOMAINS, {
    $ops: [{ domain: { $eq: domain } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const entries = Object.entries(results)
  if (entries.length === 0) return [null, null]
  return entries[0]
}
