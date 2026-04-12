import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { sendLambda, apiLambda } from './lambdas'
import { apiKeySecretArn } from './secrets'

const restApi = new aws.apigateway.RestApi('hermes-api-gw', {
  name: 'hermes',
  description: 'HERMES management and send API',
})

// Proxy resource catches all paths
const proxyResource = new aws.apigateway.Resource('hermes-proxy-resource', {
  restApi: restApi.id,
  parentId: restApi.rootResourceId,
  pathPart: '{proxy+}',
})

// Management API integration
const apiIntegration = new aws.apigateway.Integration('hermes-api-integration', {
  restApi: restApi.id,
  resourceId: proxyResource.id,
  httpMethod: 'ANY',
  integrationHttpMethod: 'POST',
  type: 'AWS_PROXY',
  uri: apiLambda.invokeArn,
})

new aws.apigateway.Method('hermes-api-method', {
  restApi: restApi.id,
  resourceId: proxyResource.id,
  httpMethod: 'ANY',
  authorization: 'NONE',
})

// /send resource
const sendResource = new aws.apigateway.Resource('hermes-send-resource', {
  restApi: restApi.id,
  parentId: restApi.rootResourceId,
  pathPart: 'send',
})

new aws.apigateway.Method('hermes-send-method', {
  restApi: restApi.id,
  resourceId: sendResource.id,
  httpMethod: 'POST',
  authorization: 'NONE',
})

new aws.apigateway.Integration('hermes-send-integration', {
  restApi: restApi.id,
  resourceId: sendResource.id,
  httpMethod: 'POST',
  integrationHttpMethod: 'POST',
  type: 'AWS_PROXY',
  uri: sendLambda.invokeArn,
})

const deployment = new aws.apigateway.Deployment('hermes-deployment', {
  restApi: restApi.id,
}, { dependsOn: [apiIntegration] })

const stage = new aws.apigateway.Stage('hermes-stage', {
  restApi: restApi.id,
  deployment: deployment.id,
  stageName: 'v1',
})

// Lambda invoke permissions
new aws.lambda.Permission('hermes-api-gw-api-permission', {
  action: 'lambda:InvokeFunction',
  function: apiLambda.name,
  principal: 'apigateway.amazonaws.com',
  sourceArn: pulumi.interpolate`${restApi.executionArn}/*/*`,
})

new aws.lambda.Permission('hermes-api-gw-send-permission', {
  action: 'lambda:InvokeFunction',
  function: sendLambda.name,
  principal: 'apigateway.amazonaws.com',
  sourceArn: pulumi.interpolate`${restApi.executionArn}/*/*`,
})

export const apiEndpoint = pulumi.interpolate`${stage.invokeUrl}`
