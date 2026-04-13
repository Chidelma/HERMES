import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { getFylo, Collections } from '../shared/fylo'
import { signJwt } from '../shared/jwt'
import { CORS, ok, badRequest, notFound, getSecret } from '../shared/http'
import { generateTotpSecret, totpProvisionUri, verifyTotp } from '../shared/totp'
import { getUserPhones } from '../shared/types'
import type { User, OtpSession, MfaSession, SetupSession, MfaDevice } from '../shared/types'

const sns = new SNSClient({ maxAttempts: 1 })

type Fylo = Awaited<ReturnType<typeof getFylo>>

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' }
  }

  const { httpMethod, path, body } = event

  // ── POST /auth/sms/request ─────────────────────────────────────────────────
  // Validates email + phone, sends SMS OTP. Used for first-time login and
  // as a fallback when the user has lost their MFA device.
  if (httpMethod === 'POST' && path === '/auth/sms/request') {
    if (!body) return badRequest('Missing body')
    let email: string, phone: string
    try { ;({ email, phone } = JSON.parse(body)) } catch { return badRequest('Invalid JSON') }
    if (!email || !phone) return badRequest('email and phone required')

    const fylo = await getFylo()
    const user = await findUserByEmailAndPhone(fylo, email.toLowerCase(), phone)
    if (!user) return notFound('No account found for these credentials')

    await purgeExpired(fylo, Collections.OTP_SESSIONS, email.toLowerCase())

    const code = String(randomInt(100000, 1000000)).padStart(6, '0')
    const sessionId = randomBytes(32).toString('hex')

    await fylo.putData(Collections.OTP_SESSIONS, {
      id: sessionId,
      email: email.toLowerCase(),
      phone,
      codeHash: sha256(code),
      expiresAt: inMinutes(5),
    } satisfies OtpSession)

    await sns.send(new PublishCommand({
      PhoneNumber: phone,
      Message: `Your HERMES code: ${code}. Expires in 5 minutes.`,
    }))

    return ok({ sessionId })
  }

  // ── POST /auth/sms/confirm ─────────────────────────────────────────────────
  // Verifies SMS OTP. If the user has no MFA devices, returns a setup token
  // so they can register their first authenticator. Otherwise grants a JWT
  // (phone verified = full access, suitable for MFA device recovery).
  if (httpMethod === 'POST' && path === '/auth/sms/confirm') {
    if (!body) return badRequest('Missing body')
    let sessionId: string, code: string
    try { ;({ sessionId, code } = JSON.parse(body)) } catch { return badRequest('Invalid JSON') }
    if (!sessionId || !code) return badRequest('sessionId and code required')

    const fylo = await getFylo()
    const [docId, session] = await findById<OtpSession>(fylo, Collections.OTP_SESSIONS, sessionId)
    if (!session || !docId) return err401('Invalid or expired session')
    if (new Date(session.expiresAt) < new Date()) {
      await fylo.delDoc(Collections.OTP_SESSIONS, docId)
      return err401('Code has expired')
    }
    if (sha256(code) !== session.codeHash) return err401('Invalid code')

    await fylo.delDoc(Collections.OTP_SESSIONS, docId)

    const user = await findUserByEmail(fylo, session.email)
    if (!user) return err401('Account not found')

    const devices = await getUserDevices(fylo, session.email)

    if (devices.length === 0) {
      // No MFA set up yet — return a setup token so the client can register a device.
      const totpSecret = generateTotpSecret()
      const setupToken = randomBytes(32).toString('hex')
      await fylo.putData(Collections.SETUP_SESSIONS, {
        id: setupToken,
        email: session.email,
        totpSecret,
        expiresAt: inMinutes(15),
      } satisfies SetupSession)
      return ok({
        requiresSetup: true,
        setupToken,
        totpSecret,
        totpUri: totpProvisionUri(session.email, totpSecret),
      })
    }

    // Phone verified — grant a JWT. The user can manage their devices from settings.
    const secret = await getSecret()
    const token = signJwt({ email: user.email, domains: user.domains, role: user.role }, secret)
    return ok({ token, email: user.email, domains: user.domains, role: user.role })
  }

  // ── POST /auth/mfa/request ─────────────────────────────────────────────────
  // Creates an MFA challenge session for the given email. If the user has no
  // registered MFA devices, signals that they must use the SMS flow first.
  if (httpMethod === 'POST' && path === '/auth/mfa/request') {
    if (!body) return badRequest('Missing body')
    let email: string
    try { ;({ email } = JSON.parse(body)) } catch { return badRequest('Invalid JSON') }
    if (!email) return badRequest('email required')

    const fylo = await getFylo()
    const user = await findUserByEmail(fylo, email.toLowerCase())
    if (!user) return notFound('No account found')

    const devices = await getUserDevices(fylo, email.toLowerCase())
    if (devices.length === 0) {
      return ok({ requiresSetup: true })
    }

    await purgeExpired(fylo, Collections.MFA_SESSIONS, email.toLowerCase())
    const mfaSessionId = randomBytes(32).toString('hex')
    await fylo.putData(Collections.MFA_SESSIONS, {
      id: mfaSessionId,
      email: email.toLowerCase(),
      expiresAt: inMinutes(5),
    } satisfies MfaSession)

    return ok({ mfaSessionId })
  }

  // ── POST /auth/mfa/confirm ─────────────────────────────────────────────────
  // Verifies a TOTP code against any of the user's registered devices.
  // Any single valid device code grants a JWT.
  if (httpMethod === 'POST' && path === '/auth/mfa/confirm') {
    if (!body) return badRequest('Missing body')
    let mfaSessionId: string, code: string
    try { ;({ mfaSessionId, code } = JSON.parse(body)) } catch { return badRequest('Invalid JSON') }
    if (!mfaSessionId || !code) return badRequest('mfaSessionId and code required')

    const fylo = await getFylo()
    const [docId, session] = await findById<MfaSession>(fylo, Collections.MFA_SESSIONS, mfaSessionId)
    if (!session || !docId) return err401('Invalid or expired session')
    if (new Date(session.expiresAt) < new Date()) {
      await fylo.delDoc(Collections.MFA_SESSIONS, docId)
      return err401('Session expired')
    }

    const devices = await getUserDevices(fylo, session.email)
    const valid = devices.some(d => verifyTotp(d.secret, code))
    if (!valid) return err401('Invalid code')

    await fylo.delDoc(Collections.MFA_SESSIONS, docId)

    const user = await findUserByEmail(fylo, session.email)
    if (!user) return err401('Account not found')

    const secret = await getSecret()
    const token = signJwt({ email: user.email, domains: user.domains, role: user.role }, secret)
    return ok({ token, email: user.email, domains: user.domains, role: user.role })
  }

  // ── POST /auth/mfa/setup ───────────────────────────────────────────────────
  // Verifies the first TOTP code against the setup session secret, then
  // registers the device and issues a JWT. Used for both first-time setup
  // (from the login flow) and adding additional devices (from settings).
  if (httpMethod === 'POST' && path === '/auth/mfa/setup') {
    if (!body) return badRequest('Missing body')
    let setupToken: string, code: string, name: string | undefined
    try { ;({ setupToken, code, name } = JSON.parse(body)) } catch { return badRequest('Invalid JSON') }
    if (!setupToken || !code) return badRequest('setupToken and code required')

    const fylo = await getFylo()
    const [docId, session] = await findById<SetupSession>(fylo, Collections.SETUP_SESSIONS, setupToken)
    if (!session || !docId) return err401('Invalid or expired setup session')
    if (new Date(session.expiresAt) < new Date()) {
      await fylo.delDoc(Collections.SETUP_SESSIONS, docId)
      return err401('Setup session expired')
    }
    if (!verifyTotp(session.totpSecret, code)) return err401('Invalid code — ensure your device clock is correct')

    await fylo.delDoc(Collections.SETUP_SESSIONS, docId)

    const deviceId = randomBytes(16).toString('hex')
    await fylo.putData(Collections.MFA_DEVICES, {
      id: deviceId,
      userEmail: session.email,
      name: name?.trim() || 'Authenticator',
      secret: session.totpSecret,
      createdAt: new Date().toISOString(),
    } satisfies MfaDevice)

    const user = await findUserByEmail(fylo, session.email)
    if (!user) return err401('Account not found')

    const secret = await getSecret()
    const token = signJwt({ email: user.email, domains: user.domains, role: user.role }, secret)
    return ok({ token, email: user.email, domains: user.domains, role: user.role })
  }

  return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function err401(message: string): APIGatewayProxyResult {
  return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: message }) }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function inMinutes(n: number): string {
  return new Date(Date.now() + n * 60 * 1000).toISOString()
}

async function findUserByEmail(fylo: Fylo, email: string): Promise<User | null> {
  const results: Record<string, any> = {}
  for await (const doc of fylo.findDocs(Collections.USERS, {
    $ops: [{ email: { $eq: email } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  return (Object.values(results)[0] as User) ?? null
}

async function findUserByEmailAndPhone(fylo: Fylo, email: string, phone: string): Promise<User | null> {
  const results: Record<string, any> = {}
  for await (const doc of fylo.findDocs(Collections.USERS, {
    $ops: [{ email: { $eq: email } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  return Object.values(results).find(u => getUserPhones(u as any).includes(phone)) as User ?? null
}

async function findById<T extends { id: string }>(
  fylo: Fylo,
  collection: string,
  id: string
): Promise<[string | null, T | null]> {
  const results: Record<string, T> = {}
  for await (const doc of fylo.findDocs(collection, {
    $ops: [{ id: { $eq: id } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const entry = Object.entries(results)[0]
  return entry ? [entry[0], entry[1]] : [null, null]
}

async function getUserDevices(fylo: Fylo, email: string): Promise<MfaDevice[]> {
  const results: Record<string, MfaDevice> = {}
  for await (const doc of fylo.findDocs(Collections.MFA_DEVICES, {
    $ops: [{ userEmail: { $eq: email } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  return Object.values(results)
}

async function purgeExpired(fylo: Fylo, collection: string, email: string): Promise<void> {
  const results: Record<string, { email: string; expiresAt: string }> = {}
  for await (const doc of fylo.findDocs(collection, {
    $ops: [{ email: { $eq: email } }],
  }).collect()) {
    Object.assign(results, doc)
  }
  const now = new Date()
  for (const [id, doc] of Object.entries(results)) {
    if (new Date(doc.expiresAt) < now) await fylo.delDoc(collection, id)
  }
}
