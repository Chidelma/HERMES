import type Fylo from '@delma/fylo'
import type { StoredEmail, PushSubscriptionRecord } from '../types.ts'
import {
  deletePushSubscriptionDoc,
  listPushSubscriptionsForAddress,
} from '../db/push.ts'
import { findUserByEmail } from '../db/users.ts'

type VapidKeys = {
  publicKey: string
  privateKey: string
}

type WebPushSubscription = {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

type WebPushModule = {
  generateVAPIDKeys: () => VapidKeys
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void
  sendNotification: (subscription: WebPushSubscription, payload?: string) => Promise<unknown>
}

let devVapidKeys: VapidKeys | null = null
let webPushModule: WebPushModule | null = null

async function loadWebPush(): Promise<WebPushModule> {
  if (webPushModule) return webPushModule

  // Keep this server-only dependency out of static frontend bundles.
  const packageName = 'web-push'
  const mod = await import(packageName)
  webPushModule = (mod.default ?? mod) as WebPushModule
  return webPushModule
}

function getVapidKeys(webPush: WebPushModule): VapidKeys {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (publicKey && privateKey) return { publicKey, privateKey }
  if (process.env.NODE_ENV === 'production' && process.env.WEB_PUSH_DISABLED !== 'true') {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required in production')
  }

  devVapidKeys ??= webPush.generateVAPIDKeys()
  return devVapidKeys
}

export async function getVapidPublicKey(): Promise<string> {
  return getVapidKeys(await loadWebPush()).publicKey
}

async function configureWebPush(): Promise<WebPushModule> {
  const webPush = await loadWebPush()
  const { publicKey, privateKey } = getVapidKeys(webPush)
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  webPush.setVapidDetails(subject, publicKey, privateKey)
  return webPush
}

export async function sendEmailNotification(
  fylo: Fylo,
  email: StoredEmail,
): Promise<{ attempted: number; sent: number; expired: number }> {
  if (process.env.WEB_PUSH_DISABLED === 'true') {
    return { attempted: 0, sent: 0, expired: 0 }
  }

  const webPush = await configureWebPush()

  const [, recipientUser] = await findUserByEmail(fylo, email.recipient)
  const subscriptions = await listPushSubscriptionsForAddress(fylo, recipientUser?.email ?? email.recipient)
  const payload = JSON.stringify({
    type: 'email.received',
    emailId: email.id,
    title: email.sender,
    body: email.subject || '(no subject)',
    url: `/inbox`,
    receivedAt: email.receivedAt,
  })

  let sent = 0
  let expired = 0

  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(toWebPushSubscription(subscription), payload)
      sent += 1
    } catch (err) {
      const statusCode = Number((err as { statusCode?: number })?.statusCode)
      if (statusCode === 404 || statusCode === 410) {
        await deletePushSubscriptionDoc(fylo, subscription.docId)
        expired += 1
      } else {
        console.error('[push] failed to send notification', {
          statusCode,
          endpoint: subscription.endpoint,
        })
      }
    }
  }

  return { attempted: subscriptions.length, sent, expired }
}

function toWebPushSubscription(subscription: PushSubscriptionRecord): WebPushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  }
}
