import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { inboundQueue, inboundQueueArn } from './queues'
import { notificationsTopic, notificationsTopicArn } from './notifications'
import { fileSystem, accessPoint, mountTargets } from './storage'
import { encryptionKeySecretArn } from './secrets'

const cfg = new pulumi.Config()
const vpcId = cfg.require('vpcId')
const subnetIds = cfg.requireObject<string[]>('subnetIds')

const EFS_MOUNT_PATH = '/mnt/hermes'

const lambdaSg = new aws.ec2.SecurityGroup('hermes-lambda-sg', {
  vpcId,
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: 'hermes-lambda-sg' },
})

const lambdaRole = new aws.iam.Role('hermes-lambda-role', {
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  }),
})

new aws.iam.RolePolicyAttachment('hermes-lambda-basic', {
  role: lambdaRole,
  policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
})

new aws.iam.RolePolicyAttachment('hermes-lambda-vpc', {
  role: lambdaRole,
  policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
})

new aws.iam.RolePolicy('hermes-lambda-policy', {
  role: lambdaRole,
  policy: pulumi.all([inboundQueueArn, notificationsTopicArn, encryptionKeySecretArn]).apply(
    ([sqsArn, snsArn, secretArn]) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], Resource: sqsArn },
          { Effect: 'Allow', Action: ['ses:SendEmail', 'ses:SendRawEmail'], Resource: '*' },
          { Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: secretArn },
          { Effect: 'Allow', Action: ['elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite'], Resource: '*' },
        ],
      })
  ),
})

const commonConfig = {
  role: lambdaRole.arn,
  runtime: aws.lambda.Runtime.NodeJS20dX,
  timeout: 300,
  memorySize: 512,
  vpcConfig: {
    subnetIds,
    securityGroupIds: [lambdaSg.id],
  },
  fileSystemConfig: {
    arn: accessPoint.arn,
    localMountPath: EFS_MOUNT_PATH,
  },
  environment: {
    variables: {
      FYLO_ROOT: EFS_MOUNT_PATH,
      NODE_OPTIONS: '--enable-source-maps',
    },
  },
}

const dependsOnMounts = { dependsOn: mountTargets }

/** Processes inbound email from SQS. */
export const inboundLambda = new aws.lambda.Function('hermes-inbound', {
  ...commonConfig,
  code: new pulumi.asset.AssetArchive({ '.': new pulumi.asset.FileArchive('../src/inbound') }),
  handler: 'index.handler',
  name: 'hermes-inbound',
}, dependsOnMounts)

export const inboundEventSource = new aws.lambda.EventSourceMapping('hermes-inbound-sqs', {
  eventSourceArn: inboundQueue.arn,
  functionName: inboundLambda.arn,
  batchSize: 10,
})

/** Handles SNS bounce/complaint/delivery events. */
export const eventsLambda = new aws.lambda.Function('hermes-events', {
  ...commonConfig,
  code: new pulumi.asset.AssetArchive({ '.': new pulumi.asset.FileArchive('../src/events') }),
  handler: 'index.handler',
  name: 'hermes-events',
}, dependsOnMounts)

export const eventsSubscription = new aws.sns.TopicSubscription('hermes-events-sub', {
  topic: notificationsTopic.arn,
  protocol: 'lambda',
  endpoint: eventsLambda.arn,
})

new aws.lambda.Permission('hermes-events-sns-permission', {
  action: 'lambda:InvokeFunction',
  function: eventsLambda.name,
  principal: 'sns.amazonaws.com',
  sourceArn: notificationsTopic.arn,
})

/** Outbound send API. */
export const sendLambda = new aws.lambda.Function('hermes-send', {
  ...commonConfig,
  code: new pulumi.asset.AssetArchive({ '.': new pulumi.asset.FileArchive('../src/send') }),
  handler: 'index.handler',
  name: 'hermes-send',
}, dependsOnMounts)

/** Management REST API. */
export const apiLambda = new aws.lambda.Function('hermes-api', {
  ...commonConfig,
  code: new pulumi.asset.AssetArchive({ '.': new pulumi.asset.FileArchive('../src/api') }),
  handler: 'index.handler',
  name: 'hermes-api',
}, dependsOnMounts)

export const lambdaRoleArn = lambdaRole.arn
