import * as aws from '@pulumi/aws'

/** SNS topic that receives SES bounce, complaint, and delivery notifications. */
export const notificationsTopic = new aws.sns.Topic('hermes-notifications', {
  name: 'hermes-ses-notifications',
  tags: { Name: 'hermes-ses-notifications' },
})

export const notificationsTopicArn = notificationsTopic.arn
