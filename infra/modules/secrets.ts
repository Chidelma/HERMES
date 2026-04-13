import * as aws from '@pulumi/aws'

export const apiKeySecret = new aws.secretsmanager.Secret('hermes-api-key', {
  name: 'hermes/api-key',
  description: 'Management API authentication key for HERMES',
})

export const encryptionKeySecret = new aws.secretsmanager.Secret('hermes-encryption-key', {
  name: 'hermes/fylo-encryption-key',
  description: 'FYLO field-level encryption key',
})

export const apiKeySecretArn = apiKeySecret.arn
export const encryptionKeySecretArn = encryptionKeySecret.arn
