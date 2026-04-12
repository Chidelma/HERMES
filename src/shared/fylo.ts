import Fylo from '@delma/fylo'

const FYLO_ROOT = process.env.FYLO_ROOT ?? '/mnt/hermes'

let _fylo: Fylo | null = null

/** Returns a shared Fylo instance, initialising collections on first call. */
export async function getFylo(): Promise<Fylo> {
  if (_fylo) return _fylo

  _fylo = new Fylo({ root: FYLO_ROOT })

  await Promise.all([
    _fylo.createCollection('domains'),
    _fylo.createCollection('emails'),
    _fylo.createCollection('suppressed'),
  ])

  return _fylo
}

export const Collections = {
  /** DomainConfig records, keyed by domain name */
  DOMAINS: 'domains',
  /** StoredEmail records */
  EMAILS: 'emails',
  /** SuppressedAddress records */
  SUPPRESSED: 'suppressed',
} as const
