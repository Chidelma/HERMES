import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { getFylo, Collections } from '../shared/fylo'
import type { DomainConfig, RouteRule } from '../shared/types'

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { httpMethod, path, body } = event
  const fylo = await getFylo()

  // GET /domains
  if (httpMethod === 'GET' && path === '/domains') {
    const results: Record<string, DomainConfig> = {}
    for await (const doc of fylo.findDocs(Collections.DOMAINS, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    return ok(Object.values(results))
  }

  // POST /domains
  if (httpMethod === 'POST' && path === '/domains') {
    if (!body) return badRequest('Missing body')
    const config: Omit<DomainConfig, 'identityArn'> & { identityArn?: string } = JSON.parse(body)
    const id = await fylo.putData(Collections.DOMAINS, { ...config, identityArn: config.identityArn ?? '' })
    return ok({ id })
  }

  // GET /domains/:domain/routes
  const routesMatch = path.match(/^\/domains\/([^/]+)\/routes$/)
  if (httpMethod === 'GET' && routesMatch) {
    const domain = decodeURIComponent(routesMatch[1])
    const config = await getDomain(fylo, domain)
    if (!config) return notFound('Domain not found')
    return ok(config.routes)
  }

  // PUT /domains/:domain/routes/:id
  const routeMatch = path.match(/^\/domains\/([^/]+)\/routes\/([^/]+)$/)
  if (httpMethod === 'PUT' && routeMatch) {
    const domain = decodeURIComponent(routeMatch[1])
    const ruleId = decodeURIComponent(routeMatch[2])
    if (!body) return badRequest('Missing body')
    const rule: RouteRule = JSON.parse(body)
    const [docId, config] = await getDomainEntry(fylo, domain)
    if (!docId || !config) return notFound('Domain not found')
    const updatedRoutes = [...config.routes.filter(r => r.id !== ruleId), { ...rule, id: ruleId }]
    await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: updatedRoutes } })
    return ok({ updated: ruleId })
  }

  // DELETE /domains/:domain/routes/:id
  if (httpMethod === 'DELETE' && routeMatch) {
    const domain = decodeURIComponent(routeMatch[1])
    const ruleId = decodeURIComponent(routeMatch[2])
    const [docId, config] = await getDomainEntry(fylo, domain)
    if (!docId || !config) return notFound('Domain not found')
    const updatedRoutes = config.routes.filter(r => r.id !== ruleId)
    await fylo.patchDoc(Collections.DOMAINS, { [docId]: { routes: updatedRoutes } })
    return ok({ deleted: ruleId })
  }

  // GET /suppressed
  if (httpMethod === 'GET' && path === '/suppressed') {
    const results: Record<string, unknown> = {}
    for await (const doc of fylo.findDocs(Collections.SUPPRESSED, { $ops: [] }).collect()) {
      Object.assign(results, doc)
    }
    return ok(Object.values(results))
  }

  // DELETE /suppressed/:address
  const suppressedMatch = path.match(/^\/suppressed\/(.+)$/)
  if (httpMethod === 'DELETE' && suppressedMatch) {
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

  return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) }
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

function ok(data: unknown): APIGatewayProxyResult {
  return { statusCode: 200, body: JSON.stringify(data) }
}

function badRequest(message: string): APIGatewayProxyResult {
  return { statusCode: 400, body: JSON.stringify({ error: message }) }
}

function notFound(message: string): APIGatewayProxyResult {
  return { statusCode: 404, body: JSON.stringify({ error: message }) }
}
