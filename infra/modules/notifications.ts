import * as aws from '@pulumi/aws'

/** SNS topic that receives SES bounce, complaint, and delivery notifications. */
export const notificationsTopic = new aws.sns.Topic('hermes-notifications', {
  name: 'hermes-ses-notifications',
  tags: { Name: 'hermes-ses-notifications' },
})

/** SNS topic used as the SES receipt rule action target (SES → SNS → SQS). */
export const inboundDeliveryTopic = new aws.sns.Topic('hermes-inbound-delivery', {
  name: 'hermes-inbound-delivery',
  tags: { Name: 'hermes-inbound-delivery' },
})

/** Allow SES to publish to the inbound delivery topic. */
export const inboundDeliveryTopicPolicy = new aws.sns.TopicPolicy('hermes-inbound-delivery-policy', {
  arn: inboundDeliveryTopic.arn,
  policy: inboundDeliveryTopic.arn.apply(arn =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 'sns:Publish',
          Resource: arn,
        },
      ],
    })
  ),
})

export const notificationsTopicArn = notificationsTopic.arn
export const inboundDeliveryTopicArn = inboundDeliveryTopic.arn
