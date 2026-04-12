import * as aws from '@pulumi/aws'

export const inboundDlq = new aws.sqs.Queue('hermes-inbound-dlq', {
  name: 'hermes-inbound-dlq',
  messageRetentionSeconds: 1209600, // 14 days
  tags: { Name: 'hermes-inbound-dlq' },
})

export const inboundQueue = new aws.sqs.Queue('hermes-inbound', {
  name: 'hermes-inbound',
  visibilityTimeoutSeconds: 300,
  messageRetentionSeconds: 86400,
  redrivePolicy: inboundDlq.arn.apply(arn =>
    JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: 3 })
  ),
  tags: { Name: 'hermes-inbound' },
})

/** Allow SES to send messages to the inbound queue. */
export const inboundQueuePolicy = new aws.sqs.QueuePolicy('hermes-inbound-policy', {
  queueUrl: inboundQueue.url,
  policy: inboundQueue.arn.apply(arn =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 'sqs:SendMessage',
          Resource: arn,
        },
      ],
    })
  ),
})

export const inboundQueueArn = inboundQueue.arn
export const inboundQueueUrl = inboundQueue.url
