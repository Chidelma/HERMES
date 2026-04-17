export interface SmsAdapter {
  send(to: string, body: string): Promise<void>
}

const consoleSms: SmsAdapter = {
  async send(to, body) {
    console.log(`[SMS → ${to}] ${body}`)
  },
}

/**
 * Returns the configured SMS adapter.
 * Reads SMS_ADAPTER env var (defaults to 'console').
 * Additional adapters (Twilio etc.) can be added here in Phase 4.
 */
export function getSmsAdapter(): SmsAdapter {
  switch (process.env.SMS_ADAPTER ?? 'console') {
    default: return consoleSms
  }
}
