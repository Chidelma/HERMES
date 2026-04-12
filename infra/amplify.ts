import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { apiEndpoint } from './api'

const cfg = new pulumi.Config()
// Optional: pulumi config set --secret hermes:githubToken ghp_xxxx
// Without it, connect GitHub manually in the Amplify console.
const githubToken = cfg.getSecret('githubToken')

const appArgs: aws.amplify.AppArgs = {
  name: 'hermes-web',
  ...(githubToken !== undefined && {
    repository: 'https://github.com/Chidelma/HERMES',
    accessToken: githubToken,
  }),
  environmentVariables: {
    HERMES_API_URL: apiEndpoint,
  },
  // Rewrite all non-asset paths to index.html for SPA client-side routing
  customRules: [{
    source: '</^[^.]+$|\\.(?!(css|js|ico|png|jpg|svg|woff|woff2|ttf|map)$)([^.]+$)/>',
    target: '/index.html',
    status: '200',
  }],
  enableBranchAutoBuild: true,
}

export const amplifyApp = new aws.amplify.App('hermes-web', appArgs)

export const amplifyBranch = new aws.amplify.Branch('hermes-web-master', {
  appId: amplifyApp.id,
  branchName: 'master',
  enableAutoBuild: true,
})

export const amplifyUrl = pulumi.interpolate`https://master.${amplifyApp.defaultDomain}`
