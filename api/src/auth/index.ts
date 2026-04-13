import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { getFylo, Collections } from '../shared/fylo'
import { signJwt } from '../shared/jwt'
import type { User, OtpSession } from '../shared/types'

const sns = new SNSClient({ maxAttempts: 1 })
const sm = new SecretsManagerClient({ maxAttempts: 1 })

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

function err(status: number, message: string): APIGatewayProxyResult {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: message }) }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' }
  }

  const { httpMethod, path, body } = event

  // POST /auth/request — validate email+phone, send OTP
  if (httpMethod === 'POST' && path === '/auth/request') {
    if (!body) return err(400, 'Missing body')
    let email: string, phone: string
    try {
      ;({ email, phone } = JSON.parse(body))
    } catch {
      return err(400, 'Invalid JSON')
    }
    if (!email || !phone) return err(400, 'email and phone required')

    const fylo = await getFylo()

    const user = await findUser(fylo, email.toLowerCase(), phone)
    if (!user) return err(404, 'No account found for these credentials')

    await purgeExpiredSessions(fylo, email.toLowerCase())

    const code = String(randomInt(100000, 1000000)).padStart(6, '0')
    const codeHash = createHash('sha256').update(code).digest('hex')
    const sessionId = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    await fylo.putData(Collections.OTP_SESSIONS, {
      id: sessionId,
      email: email.toLowerCase(),
      phone,
      codeHash,
      expiresAt,
    } satisfies OtpSession)

    await sns.send(new PublishCommand({
      PhoneNumber: phone,
      Message: `Your HERMES code: ${code}. Expires in 5 minutes.`,
    }))

    return ok({ sessionId })
  }

  // POST /auth/confirm — verify OTP, return JWT
  if (httpMethod === 'POST' && path === '/auth/confirm') {
    if (!body) return err(400, 'Missing body')
    let sessionId: string, code: string
    try {
      ;({ sessionId, code } = JSON.parse(body))
    } catch {
      return err(400, 'Invalid JSON')
    }
    if (!sessionId || !code) return err(400, 'sessionId and code required')

    const fylo = await getFylo()
    const [docId, session] = await findSession(fylo, sessionId)
    if (!session || !docId) return err(401, 'Invalid or expired code')

    if (new Date(session.expiresAt) < new Date()) {
      await fylo.delDoc(Collections.OTP_SESSIONS, docId)
      return err(401, 'Code has expired')
    }

    const codeHash = createHash('sha256').update(code).digest('hex')
    if (codeHash !== session.codeHash) return err(401, 'Invalid code')

    await fylo.delDoc(Collections.OTP_SESSIONS, docId)

    const user = await findUser(fylo, session.email, session.phone)
    if (!user) return err(401, 'Account not found')

    const secret = await getSecret()
    const token = signJwt({ email: user.email, domains: user.domains, role: user.role }, secret)

    return ok({ token, email: user.email, domains: user.domains, role: user.role })
  }

  return err(404, 'Not found')
}

async function findUser(
  fylo: Awaited<ReturnType<typeof getFylo>>,
  email: string,
  phone: string
): Promise<User | null> {
  const results: Record<string, User> = {}
  for await (const doc of fylo.findDocs(Collections.USERS, {
    $ops: [{ email: { $eq: email } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  return Object.values(results).find(u => u.phone === phone) ?? null
}

async function findSession(
  fylo: Awaited<ReturnType<typeof getFylo>>,
  sessionId: string
): Promise<[string | null, OtpSession | null]> {
  const results: Record<string, OtpSession> = {}
  for await (const doc of fylo.findDocs(Collections.OTP_SESSIONS, {
    $ops: [{ id: { $eq: sessionId } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const entry = Object.entries(results)[0]
  if (!entry) return [null, null]
  return entry
}

async function purgeExpiredSessions(
  fylo: Awaited<ReturnType<typeof getFylo>>,
  email: string
): Promise<void> {
  const results: Record<string, OtpSession> = {}
  for await (const doc of fylo.findDocs(Collections.OTP_SESSIONS, {
    $ops: [{ email: { $eq: email } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const now = new Date()
  for (const [id, session] of Object.entries(results)) {
    if (new Date(session.expiresAt) < now) {
      await fylo.delDoc(Collections.OTP_SESSIONS, id)
    }
  }
}
