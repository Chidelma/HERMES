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
