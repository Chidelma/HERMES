// ── Domain & Routing ─────────────────────────────────────────────────────────

export interface DomainConfig {
  domain: string
  routes: RouteRule[]
  inboundEnabled: boolean
}

export interface RouteRule {
  id: string
  /** Recipient match: exact address, wildcard prefix (e.g. "*@example.com"), or catchall "*" */
  match: string
  action: RouteAction
  enabled: boolean
}

export type RouteAction =
  | { type: 'webhook'; url: string; secret?: string }
  | { type: 'forward'; to: string }
  | { type: 'store' }
  | { type: 'drop' }

// ── Email Storage ─────────────────────────────────────────────────────────────

export interface StoredEmail {
  id: string
  domain: string
  recipient: string
  sender: string
  subject: string
  body: string
  folder: string
  read: boolean
  starred: boolean
  receivedAt: string
  processed: boolean
}

export interface EmailAttachmentSummary {
  id: string
  filename: string
  contentType: string
  size: number
  disposition?: string
  contentId?: string
}

export interface EmailAttachmentRecord extends EmailAttachmentSummary {
  emailId: string
  domain: string
  storagePath: string
  createdAt: string
}

// ── Suppression ───────────────────────────────────────────────────────────────

export interface SuppressedAddress {
  address: string
  reason: 'bounce' | 'complaint'
  suppressedAt: string
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface User {
  email: string
  phones: string[]
  domains: string[]
  role: 'admin' | 'viewer'
}

// ── Auth Sessions ─────────────────────────────────────────────────────────────

/** SMS OTP verification session */
export interface OtpSession {
  id: string
  email: string
  phone: string
  /** SHA-256 hex of the 6-digit code */
  codeHash: string
  expiresAt: string
}

/** Active TOTP challenge session — created by POST /auth/mfa/request */
export interface MfaSession {
  id: string
  email: string
  expiresAt: string
}

/** Pending TOTP device registration session */
export interface SetupSession {
  id: string
  email: string
  /** Base32-encoded TOTP secret */
  totpSecret: string
  expiresAt: string
}

// ── MFA Devices ───────────────────────────────────────────────────────────────

export interface MfaDevice {
  id: string
  userEmail: string
  name: string
  /** Base32-encoded TOTP secret */
  secret: string
  createdAt: string
}

// ── Push Notifications ───────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  id: string
  userEmail: string
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  createdAt: string
  updatedAt: string
  userAgent?: string
}

// ── Send ──────────────────────────────────────────────────────────────────────

export interface SendRequest {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  html?: string
  replyTo?: string[]
}

// ── Inbox Rules ───────────────────────────────────────────────────────────────

export interface InboxRule {
  id: string
  domain: string
  name: string
  enabled: boolean
  conditionMatch: 'all' | 'any'
  conditions: RuleCondition[]
  actions: InboxRuleAction[]
}

export type RuleCondition =
  | { field: 'from';    op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { field: 'to';      op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { field: 'subject'; op: 'contains' | 'equals' | 'startsWith'; value: string }

export type InboxRuleAction =
  | { type: 'folder';  folder: string }
  | { type: 'forward'; to: string }
  | { type: 'delete' }
