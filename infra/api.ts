import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { sendLambda, apiLambda, authLambda } from './lambdas'

const restApi = new aws.apigateway.RestApi('hermes-api-gw', {
  name: 'hermes',
  description: 'HERMES management and send API',
})

// /auth/{proxy+} → auth Lambda
const authResource = new aws.apigateway.Resource('hermes-auth-resource', {
  restApi: restApi.id,
  parentId: restApi.rootResourceId,
  pathPart: 'auth',
})

const authProxyResource = new aws.apigateway.Resource('hermes-auth-proxy-resource', {
  restApi: restApi.id,
  parentId: authResource.id,
  pathPart: '{proxy+}',
})

new aws.apigateway.Method('hermes-auth-method', {
  restApi: restApi.id,
  resourceId: authProxyResource.id,
  httpMethod: 'ANY',
  authorization: 'NONE',
})

const authIntegration = new aws.apigateway.Integration('hermes-auth-integration', {
  restApi: restApi.id,
  resourceId: authProxyResource.id,
  httpMethod: 'ANY',
  integrationHttpMethod: 'POST',
  type: 'AWS_PROXY',
  uri: authLambda.invokeArn,
})

new aws.lambda.Permission('hermes-api-gw-auth-permission', {
  action: 'lambda:InvokeFunction',
  function: authLambda.name,
  principal: 'apigateway.amazonaws.com',
  sourceArn: pulumi.interpolate`${restApi.executionArn}/*/*`,
})

// /{proxy+} → api Lambda (all other paths)
const proxyResource = new aws.apigateway.Resource('hermes-proxy-resource', {
  restApi: restApi.id,
  parentId: restApi.rootResourceId,
  pathPart: '{proxy+}',
})

new aws.apigateway.Method('hermes-api-method', {
  restApi: restApi.id,
  resourceId: proxyResource.id,
  httpMethod: 'ANY',
  authorization: 'NONE',
})

const apiIntegration = new aws.apigateway.Integration('hermes-api-integration', {
  restApi: restApi.id,
  resourceId: proxyResource.id,
  httpMethod: 'ANY',
  integrationHttpMethod: 'POST',
  type: 'AWS_PROXY',
  uri: apiLambda.invokeArn,
})

new aws.lambda.Permission('hermes-api-gw-api-permission', {
  action: 'lambda:InvokeFunction',
  function: apiLambda.name,
  principal: 'apigateway.amazonaws.com',
  sourceArn: pulumi.interpolate`${restApi.executionArn}/*/*`,
})

// /send → send Lambda
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

new aws.lambda.Permission('hermes-api-gw-send-permission', {
  action: 'lambda:InvokeFunction',
  function: sendLambda.name,
  principal: 'apigateway.amazonaws.com',
  sourceArn: pulumi.interpolate`${restApi.executionArn}/*/*`,
})

const deployment = new aws.apigateway.Deployment('hermes-deployment', {
  restApi: restApi.id,
}, { dependsOn: [authIntegration, apiIntegration] })

const stage = new aws.apigateway.Stage('hermes-stage', {
  restApi: restApi.id,
  deployment: deployment.id,
  stageName: 'v1',
})

export const apiEndpoint = pulumi.interpolate`${stage.invokeUrl}`
