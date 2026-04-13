import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

const cfg = new pulumi.Config()
const subnetIds = cfg.requireObject<string[]>('subnetIds')
const vpcId = cfg.require('vpcId')
const awsCfg = new pulumi.Config('aws')
const region = awsCfg.require('region')

/** EFS file system used as FYLO_ROOT for all Lambda functions. */
export const fileSystem = new aws.efs.FileSystem('hermes-efs', {
  encrypted: true,
  performanceMode: 'generalPurpose',
  throughputMode: 'bursting',
  tags: { Name: 'hermes-fylo-root' },
})

export const efsSecurityGroup = new aws.ec2.SecurityGroup('hermes-efs-sg', {
  vpcId,
  ingress: [{ protocol: 'tcp', fromPort: 2049, toPort: 2049, cidrBlocks: ['0.0.0.0/0'] }],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: 'hermes-efs-sg' },
})

export const mountTargets = subnetIds.map(
  (subnetId, i) =>
    new aws.efs.MountTarget(`hermes-efs-mt-${i}`, {
      fileSystemId: fileSystem.id,
      subnetId,
      securityGroups: [efsSecurityGroup.id],
    })
)

export const accessPoint = new aws.efs.AccessPoint('hermes-efs-ap', {
  fileSystemId: fileSystem.id,
  posixUser: { uid: 1000, gid: 1000 },
  rootDirectory: {
    path: '/hermes',
    creationInfo: { ownerUid: 1000, ownerGid: 1000, permissions: '755' },
  },
  tags: { Name: 'hermes-fylo-ap' },
})

export const efsArn = fileSystem.arn
export const accessPointArn = accessPoint.arn

// ── VPC Interface Endpoints ────────────────────────────────────────────────
// Lambdas run inside the VPC (required for EFS) but have no NAT gateway, so
// they cannot reach AWS service APIs over the internet. Interface endpoints
// give them private connectivity without any internet route.

const endpointSg = new aws.ec2.SecurityGroup('hermes-endpoint-sg', {
  vpcId,
  ingress: [{ protocol: 'tcp', fromPort: 443, toPort: 443, cidrBlocks: ['172.31.0.0/16'] }],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: { Name: 'hermes-endpoint-sg' },
})

export const secretsManagerEndpoint = new aws.ec2.VpcEndpoint('hermes-ep-secretsmanager', {
  vpcId,
  serviceName: pulumi.interpolate`com.amazonaws.${region}.secretsmanager`,
  vpcEndpointType: 'Interface',
  subnetIds,
  securityGroupIds: [endpointSg.id],
  privateDnsEnabled: true,
})

export const snsEndpoint = new aws.ec2.VpcEndpoint('hermes-ep-sns', {
  vpcId,
  serviceName: pulumi.interpolate`com.amazonaws.${region}.sns`,
  vpcEndpointType: 'Interface',
  subnetIds,
  securityGroupIds: [endpointSg.id],
  privateDnsEnabled: true,
})

export const sesEndpoint = new aws.ec2.VpcEndpoint('hermes-ep-ses', {
  vpcId,
  serviceName: pulumi.interpolate`com.amazonaws.${region}.email`,
  vpcEndpointType: 'Interface',
  subnetIds,
  securityGroupIds: [endpointSg.id],
  privateDnsEnabled: true,
})
