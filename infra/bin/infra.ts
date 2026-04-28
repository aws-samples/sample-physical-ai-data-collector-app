#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PAIStack } from '../lib/pai-stack';
import { PAIInviteStack } from '../lib/pai-invite-stack';
import { PAIAdminStack } from '../lib/pai-admin-stack';

const app = new cdk.App();
const region = app.node.tryGetContext('region') || 'ap-northeast-2';
const mode   = (app.node.tryGetContext('mode') ?? 'dev') as 'dev' | 'prod';

const dataStack = new PAIStack(app, 'PAIDataStack', {
  env: { region },
  mode,
});

const inviteStack = new PAIInviteStack(app, 'PAIInviteStack', {
  env: { region },
  appUserPoolId:  dataStack.userPoolId,
  appUserPoolArn: dataStack.userPoolArn,
  sesFromEmail:   app.node.tryGetContext('sesFromEmail') ?? 'noreply@example.com',
});

new PAIAdminStack(app, 'PAIAdminStack', {
  env: { region },
  userPoolId:       dataStack.userPoolId,
  userPoolArn:      dataStack.userPoolArn,
  userPoolClientId: dataStack.userPoolClientId,
  identityPoolId:   dataStack.identityPoolId,
  appBucketName:    dataStack.bucketName,
  inviteTableName:  'pai-invite-tokens',
  inviteApiEndpoint: inviteStack.inviteApiEndpoint,
  region,
});
