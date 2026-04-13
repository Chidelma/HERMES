import type { APIGatewayProxyResult } from 'aws-lambda'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
}

export function ok(data: unknown): APIGatewayProxyResult {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(data) }
}

export function badRequest(message: string): APIGatewayProxyResult {
  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: message }) }
}

export function notFound(message: string): APIGatewayProxyResult {
  return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: message }) }
}

export function unauthorized(message = 'Unauthorized'): APIGatewayProxyResult {
  return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: message }) }
}

export function forbidden(): APIGatewayProxyResult {
  return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Forbidden' }) }
}

// Cached per Lambda container — each bundle gets its own module scope.
const sm = new SecretsManagerClient({ maxAttempts: 1 })
let _secret: string | null = null

export async function getSecret(): Promise<string> {
  if (_secret) return _secret
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN }))
  _secret = res.SecretString!
  return _secret
}
