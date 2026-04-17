import { getJwtSecret, verifyJwt, type JwtClaims } from './auth.ts'
import { r401 } from './respond.ts'
import type { HandlerPayload } from './handler.ts'

export function requireClaims(context: HandlerPayload['context']): JwtClaims | ReturnType<typeof r401> {
  const claims = verifyJwt(context.bearer?.token ?? '', getJwtSecret())
  return claims ?? r401('Authentication required')
}

export function isAuthError(value: unknown): value is ReturnType<typeof r401> {
  return Boolean(value && typeof value === 'object' && 'unauthorized' in value)
}
