import type { SendRequest } from '../types.ts'

export interface SmtpAdapter {
  sendEmail(from: string, req: SendRequest): Promise<{ messageId: string }>
  forwardEmail(from: string, to: string, subject: string): Promise<void>
}

const consoleSmtp: SmtpAdapter = {
  async sendEmail(from, req) {
    const id = `console-${Date.now()}`
    console.log(`[SMTP] FROM=${from} TO=${req.to.join(',')} SUBJECT=${req.subject} [${id}]`)
    return { messageId: id }
  },
  async forwardEmail(from, to, subject) {
    console.log(`[SMTP FORWARD] FROM=${from} TO=${to} SUBJECT=Fwd: ${subject}`)
  },
}

/**
 * Returns the configured SMTP adapter.
 * Reads SMTP_ADAPTER env var (defaults to 'console').
 * Real nodemailer/SMTP adapter will be added in Phase 4.
 */
export function getSmtpAdapter(): SmtpAdapter {
  switch (process.env.SMTP_ADAPTER ?? 'console') {
    default: return consoleSmtp
  }
}
