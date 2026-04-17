/**
 * Error response helpers that produce distinct JSON shapes per status code.
 * Tachyon's matchStatusCode matches stdout JSON against OPTIONS schemas in
 * ascending order — the extra discriminating fields (unauthorized, forbidden,
 * notFound) ensure each status maps to exactly one shape.
 */

export const r400 = (error: string) =>
  ({ error })

export const r401 = (error: string) =>
  ({ error, unauthorized: true as const })

export const r403 = (error: string) =>
  ({ error, forbidden: true as const })

export const r404 = (error: string) =>
  ({ error, notFound: true as const })

export const r429 = (error: string, retryAfterSeconds: number) =>
  ({ error, retryAfterSeconds, rateLimited: true as const })

export const r422 = (error: string, blocked: string[]) =>
  ({ error, blocked })
