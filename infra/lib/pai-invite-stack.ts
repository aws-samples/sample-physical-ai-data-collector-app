import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export interface PAIInviteStackProps extends cdk.StackProps {
  appUserPoolId: string;
  appUserPoolArn: string;
  sesFromEmail?: string;
}

export class PAIInviteStack extends cdk.Stack {
  public readonly inviteApiEndpoint: string;

  constructor(scope: Construct, id: string, props: PAIInviteStackProps) {
    super(scope, id, props);

    // ── DynamoDB: invite tokens ──────────────────────────────────────────────
    const inviteTable = new dynamodb.Table(this, 'PAIInviteTokens', {
      tableName: 'pai-invite-tokens',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // TTL on expiresAt so expired tokens are auto-cleaned from DynamoDB
      timeToLiveAttribute: 'expiresAt',
    });

    // ── Lambda: shared env & runtime ─────────────────────────────────────────
    const commonEnv = { TABLE_NAME: inviteTable.tableName };
    const runtime = lambda.Runtime.PYTHON_3_12;
    const lambdaPath = (name: string) =>
      `${__dirname}/../lambda/${name}`;

    // ── Lambda: register-user — called directly from Android app ─────────────
    const registerUserFn = new lambda.Function(this, 'RegisterUserFn', {
      functionName: 'pai-register-user',
      runtime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(lambdaPath('register-user')),
      timeout: cdk.Duration.seconds(15),
      environment: {
        APP_USER_POOL_ID: props.appUserPoolId,
        SES_FROM_EMAIL:   props.sesFromEmail ?? 'byochong@amazon.com',
        SES_REGION:       this.region,
      },
    });

    registerUserFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminDeleteUser',
      ],
      resources: [props.appUserPoolArn],
    }));
    registerUserFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));

    const validateFn = new lambda.Function(this, 'ValidateInviteFn', {
      functionName: 'pai-validate-invite',
      runtime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(lambdaPath('validate-invite')),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
    });

    const extendFn = new lambda.Function(this, 'ExtendInviteFn', {
      functionName: 'pai-extend-invite',
      runtime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(lambdaPath('extend-invite')),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
    });

    const revokeFn = new lambda.Function(this, 'RevokeInviteFn', {
      functionName: 'pai-revoke-invite',
      runtime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(lambdaPath('revoke-invite')),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
    });

    inviteTable.grantReadWriteData(validateFn);
    inviteTable.grantReadWriteData(extendFn);
    inviteTable.grantReadWriteData(revokeFn);

    // ── API Gateway ──────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'PAIInviteApi', {
      restApiName: 'PAI Invite API',
      description: 'Invite token management for PAI Mobile App',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
    });

    // POST /invite/register — public endpoint called from Android app (no auth)
    const inviteResource = api.root.addResource('invite');
    const registerResource = inviteResource.addResource('register');
    registerResource.addMethod('POST', new apigateway.LambdaIntegration(registerUserFn));

    // POST /invite/validate
    const validateResource = inviteResource.addResource('validate');
    validateResource.addMethod('POST', new apigateway.LambdaIntegration(validateFn));

    // PATCH /invite/{token}
    // DELETE /invite/{token}
    const tokenResource = inviteResource.addResource('{token}');
    tokenResource.addMethod('PATCH', new apigateway.LambdaIntegration(extendFn));
    tokenResource.addMethod('DELETE', new apigateway.LambdaIntegration(revokeFn));

    // ── Outputs ───────────────────────────────────────────────────────────────
    this.inviteApiEndpoint = api.url;

    new cdk.CfnOutput(this, 'InviteApiEndpoint', {
      value: api.url,
      exportName: 'PAIInviteApiEndpoint',
    });

    new cdk.CfnOutput(this, 'InviteTableName', {
      value: inviteTable.tableName,
    });
  }
}
