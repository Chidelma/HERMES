export interface DomainConfig {
  domain: string
  /** SES verified identity ARN */
  identityArn: string
  /** Routing rules: maps recipient address/pattern to a webhook URL or forwarding address */
  routes: RouteRule[]
  /** Whether inbound receipt is enabled for this domain */
  inboundEnabled: boolean
}

export interface RouteRule {
  id: string
  /** Recipient match: exact address, wildcard prefix (e.g. "*@example.com"), or catchall */
  match: string
  action: RouteAction
  enabled: boolean
}

export type RouteAction =
  | { type: 'webhook'; url: string; secret?: string }
  | { type: 'forward'; to: string }
  | { type: 'store' }
  | { type: 'drop' }

export interface StoredEmail {
  id: string
  domain: string
  recipient: string
  sender: string
  subject: string
  /** Raw MIME message stored as base64 */
  rawKey: string
  receivedAt: string
  processed: boolean
}

export interface SuppressedAddress {
  address: string
  reason: 'bounce' | 'complaint'
  suppressedAt: string
}

export interface User {
  email: string
  /** E.164 format, e.g. +14165551234 */
  phone: string
  /** Domains this user may access */
  domains: string[]
  role: 'admin' | 'viewer'
}

export interface OtpSession {
  id: string
  email: string
  phone: string
  /** SHA-256 hex of the 6-digit code */
  codeHash: string
  expiresAt: string
}

export interface SendRequest {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  html?: string
  replyTo?: string[]
}
