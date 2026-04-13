import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { getFylo, Collections } from '../shared/fylo'
import { verifyJwt } from '../shared/jwt'
import { CORS, ok, badRequest, unauthorized, getSecret } from '../shared/http'
import type { SendRequest, SuppressedAddress } from '../shared/types'

const ses = new SESClient({ maxAttempts: 1 })

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' }
  }

  // From address comes from the JWT, not the request body — auth is required.
  const secret = await getSecret()
  const authHeader = event.headers['Authorization'] ?? event.headers['authorization'] ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const claims = token ? verifyJwt(token, secret) : null
  if (!claims) return unauthorized()

  if (!event.body) return badRequest('Missing body')

  let req: SendRequest
  try {
    req = JSON.parse(event.body)
  } catch {
    return badRequest('Invalid JSON')
  }

  const fylo = await getFylo()

  const suppressed = await getSuppressedAddresses(fylo)
  const blocked = req.to.filter(addr => suppressed.has(addr))
  if (blocked.length > 0) {
    return { statusCode: 422, headers: CORS, body: JSON.stringify({ error: 'Recipients are suppressed', blocked }) }
  }

  try {
    const result = await ses.send(new SendEmailCommand({
      Source: claims.email,
      Destination: {
        ToAddresses: req.to,
        CcAddresses: req.cc,
        BccAddresses: req.bcc,
      },
      Message: {
        Subject: { Data: req.subject, Charset: 'UTF-8' },
        Body: {
          ...(req.text ? { Text: { Data: req.text, Charset: 'UTF-8' } } : {}),
          ...(req.html ? { Html: { Data: req.html, Charset: 'UTF-8' } } : {}),
        },
      },
      ReplyToAddresses: req.replyTo,
    }))

    return ok({ messageId: result.MessageId })
  } catch (err) {
    console.error('SES send error', err)
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Send failed' }) }
  }
}

async function getSuppressedAddresses(fylo: Awaited<ReturnType<typeof getFylo>>): Promise<Set<string>> {
  const results: Record<string, SuppressedAddress> = {}
  for await (const doc of fylo.findDocs(Collections.SUPPRESSED, { $ops: [] }).collect()) {
    Object.assign(results, doc)
  }
  return new Set(Object.values(results).map(r => r.address))
}
