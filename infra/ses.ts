import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { inboundQueueArn } from './queues'
import { notificationsTopicArn } from './notifications'

const cfg = new pulumi.Config()
const domains = cfg.requireObject<string[]>('domains')

/** One SES domain identity per configured domain. */
export const domainIdentities = domains.map(
  domain =>
    new aws.ses.DomainIdentity(`hermes-ses-${domain}`, {
      domain,
    })
)

/** DKIM tokens per domain (add as CNAME records in Route 53). */
export const domainDkims = domainIdentities.map(
  (identity, i) =>
    new aws.ses.DomainDkim(`hermes-dkim-${domains[i]}`, {
      domain: identity.domain,
    })
)

/** Active receipt rule set (SES allows only one active at a time). */
export const receiptRuleSet = new aws.ses.ReceiptRuleSet('hermes-receipt-rules', {
  ruleSetName: 'hermes-inbound',
})

export const activeRuleSet = new aws.ses.ActiveReceiptRuleSet('hermes-active-rule-set', {
  ruleSetName: receiptRuleSet.ruleSetName,
})

/** One catch-all receipt rule per domain: deliver to SQS. */
export const receiptRules = domains.map(
  (domain, i) =>
    new aws.ses.ReceiptRule(`hermes-receipt-${domain}`, {
      name: `hermes-inbound-${domain}`,
      ruleSetName: receiptRuleSet.ruleSetName,
      recipients: [domain],
      enabled: true,
      scanEnabled: true,
      sqsActions: [
        {
          queueArn: inboundQueueArn,
          position: 1,
        },
      ],
    }, { dependsOn: [activeRuleSet] })
)

/** Wire bounce/complaint/delivery notifications to SNS per domain identity. */
export const domainNotifications = domainIdentities.flatMap((identity, i) =>
  (['Bounce', 'Complaint', 'Delivery'] as const).map(
    notificationType =>
      new aws.ses.IdentityNotificationTopic(`hermes-notif-${domains[i]}-${notificationType}`, {
        identity: identity.domain,
        notificationType,
        topicArn: notificationsTopicArn,
        includeOriginalHeaders: notificationType !== 'Delivery',
      })
  )
)

export const domainIdentityArns = domainIdentities.map(d => d.arn)
