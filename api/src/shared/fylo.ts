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
    _fylo.createCollection('users'),
    _fylo.createCollection('otp-sessions'),
    _fylo.createCollection('inbox-rules'),
  ])

  return _fylo
}

export const Collections = {
  DOMAINS:      'domains',
  EMAILS:       'emails',
  SUPPRESSED:   'suppressed',
  USERS:        'users',
  OTP_SESSIONS: 'otp-sessions',
  INBOX_RULES:  'inbox-rules',
} as const
