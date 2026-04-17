import Fylo from '@delma/fylo'

export type { default as Fylo } from '@delma/fylo'

export const Collections = {
  DOMAINS:        'domains',
  EMAILS:         'emails',
  ATTACHMENTS:    'attachments',
  SUPPRESSED:     'suppressed',
  USERS:          'users',
  OTP_SESSIONS:   'otp-sessions',
  INBOX_RULES:    'inbox-rules',
  MFA_DEVICES:    'mfa-devices',
  MFA_SESSIONS:   'mfa-sessions',
  SETUP_SESSIONS: 'setup-sessions',
  PUSH_SUBSCRIPTIONS: 'push-subscriptions',
} as const

/**
 * Creates a Fylo instance and ensures all collections exist.
 * Pass a custom `root` for test isolation (e.g. a temp directory).
 * Falls back to the `FYLO_ROOT` env var, then `/mnt/hermes`.
 */
export async function createDb(root?: string): Promise<Fylo> {
  const fylo = new Fylo({ root: root ?? process.env.FYLO_ROOT ?? '/mnt/hermes' })

  await Promise.all(
    Object.values(Collections).map(name => fylo.createCollection(name))
  )

  return fylo
}

/** Collect all documents from a Fylo async generator into a plain record. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function collect<T extends Record<string, any>>(
  // Fylo's findDocs returns a union generator; widening to AsyncIterable<any> avoids type-incompatibility
  gen: AsyncIterable<any> // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<Record<string, T>> {
  const results: Record<string, T> = {}
  for await (const doc of gen) {
    Object.assign(results, doc)
  }
  return results
}
