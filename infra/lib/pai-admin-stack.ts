import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PAIAdminStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
  identityPoolId: string;
  appBucketName: string;
  inviteTableName: string;
  inviteApiEndpoint: string;
  region: string;
}

export class PAIAdminStack extends cdk.Stack {
  public readonly adminConsoleUrl: string;

  constructor(scope: Construct, id: string, props: PAIAdminStackProps) {
    super(scope, id, props);

    // Import the app UserPool (defined in PAIDataStack)
    const appUserPool = cognito.UserPool.fromUserPoolArn(this, 'AppUserPool', props.userPoolArn);

    // ── Secrets Manager: Admin password ──────────────────────────────────────
    const adminSecret = new secretsmanager.Secret(this, 'AdminPassword', {
      secretName: `pai-admin-password-${this.account}`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        passwordLength: 16,
        excludeCharacters: '"@/\\',
      },
    });

    // ── Cognito: Admin User Pool (separate from app user pool) ───────────────
    const adminUserPool = new cognito.UserPool(this, 'AdminUserPool', {
      userPoolName: 'pai-admin-users',
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const adminUserPoolDomainPrefix = `pai-admin-${this.account}`.substring(0, 63);
    const adminDomain = new cognito.UserPoolDomain(this, 'AdminDomain', {
      userPool: adminUserPool,
      cognitoDomain: { domainPrefix: adminUserPoolDomainPrefix },
    });

    // ── S3: Admin Console hosting ─────────────────────────────────────────────
    const adminWebBucket = new s3.Bucket(this, 'AdminWebBucket', {
      bucketName: `pai-admin-console-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const adminSourceBucket = new s3.Bucket(this, 'AdminSourceBucket', {
      bucketName: `pai-admin-source-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
    });

    // ── CloudFront OAC ────────────────────────────────────────────────────────
    const oac = new cloudfront.CfnOriginAccessControl(this, 'AdminOAC', {
      originAccessControlConfig: {
        name: 'PAIAdminOAC',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        description: 'OAC for PAI Admin Console S3 origin',
      },
    });

    const distribution = new cloudfront.CfnDistribution(this, 'AdminDistribution', {
      distributionConfig: {
        enabled: true,
        defaultRootObject: 'index.html',
        priceClass: 'PriceClass_100',
        httpVersion: 'http2',
        comment: 'PAI Admin Console',
        origins: [{
          id: 'S3Origin',
          domainName: adminWebBucket.bucketRegionalDomainName,
          s3OriginConfig: { originAccessIdentity: '' },
          originAccessControlId: oac.ref,
        }],
        defaultCacheBehavior: {
          targetOriginId: 'S3Origin',
          viewerProtocolPolicy: 'redirect-to-https',
          cachePolicyId: cloudfront.CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
          compress: true,
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD'],
        },
        customErrorResponses: [
          { errorCode: 403, responseCode: 200, responsePagePath: '/index.html', errorCachingMinTtl: 0 },
          { errorCode: 404, responseCode: 200, responsePagePath: '/index.html', errorCachingMinTtl: 0 },
        ],
        viewerCertificate: { cloudFrontDefaultCertificate: true },
      },
    });

    adminWebBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontOACRead',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [`${adminWebBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.ref}`,
          },
        },
      })
    );

    const consoleDomain = `https://${distribution.attrDomainName}`;

    // ── Cognito: Admin App Client ─────────────────────────────────────────────
    const adminAppClient = new cognito.UserPoolClient(this, 'AdminAppClient', {
      userPool: adminUserPool,
      userPoolClientName: 'pai-admin-web',
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          `${consoleDomain}/callback`,
          consoleDomain,
          'http://localhost:5174/callback',
          'http://localhost:5174',
        ],
        logoutUrls: [consoleDomain, 'http://localhost:5174'],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    // ── Lambda: Sync admin credentials (Secrets Manager → Cognito) ───────────
    const syncAdminFn = new lambda.Function(this, 'SyncAdminFn', {
      functionName: 'pai-admin-sync-fn',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        SECRET_ARN: adminSecret.secretArn,
        USER_POOL_ID: adminUserPool.userPoolId,
        ADMIN_USERNAME: 'admin',
      },
      code: lambda.Code.fromInline(`
import boto3, json, os

cognito = boto3.client('cognito-idp')
sm = boto3.client('secretsmanager')

def handler(event, context):
    secret = json.loads(sm.get_secret_value(SecretId=os.environ['SECRET_ARN'])['SecretString'])
    username = os.environ['ADMIN_USERNAME']
    pool_id  = os.environ['USER_POOL_ID']
    password = secret['password']

    # Check if user exists
    try:
        cognito.admin_get_user(UserPoolId=pool_id, Username=username)
        # User exists — update password
        cognito.admin_set_user_password(
            UserPoolId=pool_id,
            Username=username,
            Password=password,
            Permanent=True,
        )
        print(f"Updated password for {username}")
    except cognito.exceptions.UserNotFoundException:
        # Create user
        cognito.admin_create_user(
            UserPoolId=pool_id,
            Username=username,
            TemporaryPassword=password,
            MessageAction='SUPPRESS',
        )
        cognito.admin_set_user_password(
            UserPoolId=pool_id,
            Username=username,
            Password=password,
            Permanent=True,
        )
        print(f"Created admin user {username}")

    return {'statusCode': 200, 'body': 'OK'}
`),
    });

    adminSecret.grantRead(syncAdminFn);
    syncAdminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminSetUserPassword',
      ],
      resources: [adminUserPool.userPoolArn],
    }));

    // Custom Resource: sync on every deploy
    const syncTrigger = new lambda.Function(this, 'SyncTriggerFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(2),
      code: lambda.Code.fromInline(`
import boto3, json, urllib.request, os

def handler(event, context):
    if event['RequestType'] in ('Create', 'Update'):
        lam = boto3.client('lambda')
        try:
            resp = lam.invoke(FunctionName=os.environ['SYNC_FN'], InvocationType='RequestResponse')
            print(f"Sync result: {resp['StatusCode']}")
        except Exception as e:
            print(f"Sync error (non-fatal): {e}")
    send(event, context, 'SUCCESS', {}, event.get('PhysicalResourceId', 'sync'))

def send(event, context, status, data, physical_id):
    body = json.dumps({
        'Status': status, 'Reason': 'See CloudWatch Logs', 'PhysicalResourceId': physical_id,
        'StackId': event['StackId'], 'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'], 'Data': data,
    }).encode()
    req = urllib.request.Request(event['ResponseURL'], data=body, method='PUT',
        headers={'Content-Type': '', 'Content-Length': str(len(body))})
    urllib.request.urlopen(req)
`),
      environment: { SYNC_FN: syncAdminFn.functionName },
    });

    syncTrigger.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [syncAdminFn.functionArn],
    }));

    new CustomResource(this, 'InitialAdminSync', {
      serviceToken: syncTrigger.functionArn,
      properties: {
        SecretArn: adminSecret.secretArn,
        // Changes whenever the secret name changes — forces resync on re-deploy
        Version: cdk.Names.uniqueId(adminSecret).substring(0, 12),
      },
    });

    // ── Lambda: Admin API functions ───────────────────────────────────────────
    const commonEnv = {
      INVITE_TABLE: props.inviteTableName,
      APP_USER_POOL_ID: props.userPoolId,
      REGION: props.region,
    };

    const changePasswordFn = new lambda.Function(this, 'ChangePasswordFn', {
      functionName: 'pai-change-admin-password',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(`${__dirname}/../lambda/change-password`),
      timeout: cdk.Duration.seconds(15),
      environment: {
        SECRET_ARN:           adminSecret.secretArn,
        ADMIN_USER_POOL_ID:   adminUserPool.userPoolId,
        ADMIN_USERNAME:       'admin',
      },
    });

    adminSecret.grantRead(changePasswordFn);
    adminSecret.grantWrite(changePasswordFn);
    changePasswordFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminSetUserPassword'],
      resources: [adminUserPool.userPoolArn],
    }));

    const createInviteFn = new lambda.Function(this, 'CreateInviteFn', {
      functionName: 'pai-create-invite',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(`${__dirname}/../lambda/create-invite`),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
    });

    const listInvitesFn = new lambda.Function(this, 'ListInvitesFn', {
      functionName: 'pai-list-invites',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(`${__dirname}/../lambda/list-invites`),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
    });

    const listMembersFn = new lambda.Function(this, 'ListMembersFn', {
      functionName: 'pai-list-members',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      environment: { APP_USER_POOL_ID: props.userPoolId },
      code: lambda.Code.fromInline(`
import boto3, json, os

cognito = boto3.client('cognito-idp')

def handler(event, context):
    pool_id = os.environ['APP_USER_POOL_ID']
    users = []
    paginator = cognito.get_paginator('list_users')
    for page in paginator.paginate(UserPoolId=pool_id):
        for u in page['Users']:
            attrs = {a['Name']: a['Value'] for a in u['Attributes']}
            users.append({
                'username':  u['Username'],
                'email':     attrs.get('email', ''),
                'sub':       attrs.get('sub', ''),
                'status':    u['UserStatus'],
                'createdAt': u['UserCreateDate'].isoformat(),
            })
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'users': users, 'count': len(users)}),
    }
`),
    });

    // Grant DynamoDB access to invite functions
    createInviteFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [`arn:aws:dynamodb:${props.region}:${this.account}:table/${props.inviteTableName}`],
    }));
    listInvitesFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Scan'],
      resources: [`arn:aws:dynamodb:${props.region}:${this.account}:table/${props.inviteTableName}`],
    }));
    listMembersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers'],
      resources: [appUserPool.userPoolArn],
    }));

    // ── API Gateway: Admin API ────────────────────────────────────────────────
    const adminApi = new apigateway.RestApi(this, 'AdminApi', {
      restApiName: 'PAI Admin API',
      description: 'Admin operations: create/list invites, list members',
      defaultCorsPreflightOptions: {
        allowOrigins: [consoleDomain, 'http://localhost:5174'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: { stageName: 'prod' },
    });

    const adminCognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'AdminAuth', {
      cognitoUserPools: [adminUserPool],
      authorizerName: 'AdminCognitoAuth',
      identitySource: 'method.request.header.Authorization',
    });

    const authOpts = {
      authorizer: adminCognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // POST /admin/invites — create new invite token
    const adminResource = adminApi.root.addResource('admin');
    const invitesResource = adminResource.addResource('invites');
    invitesResource.addMethod('POST', new apigateway.LambdaIntegration(createInviteFn), authOpts);
    invitesResource.addMethod('GET',  new apigateway.LambdaIntegration(listInvitesFn), authOpts);

    // GET /admin/members — list all app users
    const membersResource = adminResource.addResource('members');
    membersResource.addMethod('GET', new apigateway.LambdaIntegration(listMembersFn), authOpts);

    // POST /admin/password — change admin password (Cognito + Secrets Manager)
    const passwordResource = adminResource.addResource('password');
    passwordResource.addMethod('POST', new apigateway.LambdaIntegration(changePasswordFn), authOpts);

    // ── CodeBuild: Admin Console deployment ───────────────────────────────────
    const adminBuildProject = new codebuild.Project(this, 'AdminBuildProject', {
      projectName: `${this.stackName}-admin-build`,
      description: 'Build and deploy PAI Admin Console to S3/CloudFront',
      source: codebuild.Source.s3({ bucket: adminSourceBucket, path: '' }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        VITE_ADMIN_API_URL:              { value: adminApi.url },
        VITE_USER_POOL_ID:               { value: adminUserPool.userPoolId },
        VITE_USER_POOL_CLIENT_ID:        { value: adminAppClient.userPoolClientId },
        VITE_USER_POOL_DOMAIN:           { value: `https://${adminUserPoolDomainPrefix}.auth.${props.region}.amazoncognito.com` },
        VITE_OAUTH_REDIRECT_URI:         { value: consoleDomain },
        VITE_REGION:                     { value: props.region },
        // App-level infra values pre-filled in CreateQR form
        VITE_INVITE_API_ENDPOINT:        { value: props.inviteApiEndpoint },
        VITE_APP_BUCKET_NAME:            { value: props.appBucketName },
        VITE_APP_USER_POOL_ID:           { value: props.userPoolId },
        VITE_APP_USER_POOL_CLIENT_ID:    { value: props.userPoolClientId },
        VITE_APP_IDENTITY_POOL_ID:       { value: props.identityPoolId },
        WEBAPP_BUCKET:                   { value: adminWebBucket.bucketName },
        DISTRIBUTION_ID:                 { value: distribution.ref },
        DEPLOY_REGION:                   { value: this.region },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: '20' },
            commands: ['npm i'],
          },
          build: {
            commands: [
              'echo "VITE_ADMIN_API_URL=$VITE_ADMIN_API_URL" > .env.production',
              'echo "VITE_USER_POOL_ID=$VITE_USER_POOL_ID" >> .env.production',
              'echo "VITE_USER_POOL_CLIENT_ID=$VITE_USER_POOL_CLIENT_ID" >> .env.production',
              'echo "VITE_USER_POOL_DOMAIN=$VITE_USER_POOL_DOMAIN" >> .env.production',
              'echo "VITE_OAUTH_REDIRECT_URI=$VITE_OAUTH_REDIRECT_URI" >> .env.production',
              'echo "VITE_REGION=$VITE_REGION" >> .env.production',
              'echo "VITE_INVITE_API_ENDPOINT=$VITE_INVITE_API_ENDPOINT" >> .env.production',
              'echo "VITE_APP_BUCKET_NAME=$VITE_APP_BUCKET_NAME" >> .env.production',
              'echo "VITE_APP_USER_POOL_ID=$VITE_APP_USER_POOL_ID" >> .env.production',
              'echo "VITE_APP_USER_POOL_CLIENT_ID=$VITE_APP_USER_POOL_CLIENT_ID" >> .env.production',
              'echo "VITE_APP_IDENTITY_POOL_ID=$VITE_APP_IDENTITY_POOL_ID" >> .env.production',
              'npm run build',
            ],
          },
          post_build: {
            commands: [
              'aws s3 sync dist/ s3://$WEBAPP_BUCKET/ --region $DEPLOY_REGION --delete --cache-control "max-age=31536000,immutable"',
              'aws s3 cp dist/index.html s3://$WEBAPP_BUCKET/index.html --region $DEPLOY_REGION --cache-control "no-cache, no-store, must-revalidate"',
              'aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"',
            ],
          },
        },
        cache: { paths: ['node_modules/**/*'] },
      }),
      timeout: cdk.Duration.minutes(20),
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
    });

    adminSourceBucket.grantRead(adminBuildProject);
    adminWebBucket.grantReadWrite(adminBuildProject);
    adminBuildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.ref}`],
    }));

    // Custom Resource: trigger build on deploy
    const triggerBuildFn = new lambda.Function(this, 'TriggerAdminBuildFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      environment: { PROJECT_NAME: adminBuildProject.projectName },
      code: lambda.Code.fromInline(`
import boto3, json, urllib.request, os

def handler(event, context):
    if event['RequestType'] in ('Create', 'Update'):
        cb = boto3.client('codebuild')
        try:
            resp = cb.start_build(projectName=os.environ['PROJECT_NAME'])
            build_id = resp['build']['id']
            print(f"Build started: {build_id}")
            send(event, context, 'SUCCESS', {'BuildId': build_id}, build_id)
        except Exception as e:
            send(event, context, 'SUCCESS', {'Error': str(e)}, 'trigger-failed')
    else:
        send(event, context, 'SUCCESS', {}, event.get('PhysicalResourceId', 'trigger'))

def send(event, context, status, data, physical_id):
    body = json.dumps({
        'Status': status, 'Reason': 'See CloudWatch Logs', 'PhysicalResourceId': physical_id,
        'StackId': event['StackId'], 'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'], 'Data': data,
    }).encode()
    req = urllib.request.Request(event['ResponseURL'], data=body, method='PUT',
        headers={'Content-Type': '', 'Content-Length': str(len(body))})
    urllib.request.urlopen(req)
`),
    });

    triggerBuildFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['codebuild:StartBuild'],
      resources: [adminBuildProject.projectArn],
    }));

    // Upload admin console source to S3 — must complete before build is triggered
    const deployAdminSource = new s3deploy.BucketDeployment(this, 'DeployAdminSource', {
      sources: [s3deploy.Source.asset('./admin', {
        exclude: ['node_modules/**', 'dist/**', '.env*', 'package-lock.json'],
      })],
      destinationBucket: adminSourceBucket,
      prune: true,
    });

    const adminBuildTrigger = new CustomResource(this, 'AdminBuildTrigger', {
      serviceToken: triggerBuildFn.functionArn,
      properties: {
        ProjectName: adminBuildProject.projectName,
        BuildVersion: cdk.FileSystem.fingerprint(path.join(__dirname, '../admin/src')).substring(0, 12),
      },
    });
    adminBuildTrigger.node.addDependency(deployAdminSource);

    // ── Outputs ───────────────────────────────────────────────────────────────
    this.adminConsoleUrl = consoleDomain;

    new cdk.CfnOutput(this, 'AdminConsoleUrl', {
      value: consoleDomain,
      description: 'Admin Console URL (CloudFront)',
      exportName: 'PAIAdminConsoleUrl',
    });
    new cdk.CfnOutput(this, 'AdminSecretArn', {
      value: adminSecret.secretArn,
      description: 'Secrets Manager ARN for admin password',
      exportName: 'PAIAdminSecretArn',
    });
    new cdk.CfnOutput(this, 'AdminApiUrl', {
      value: adminApi.url,
      description: 'Admin API Gateway URL',
      exportName: 'PAIAdminApiUrl',
    });
    new cdk.CfnOutput(this, 'AdminUserPoolId', {
      value: adminUserPool.userPoolId,
      description: 'Admin Cognito User Pool ID',
    });
    new cdk.CfnOutput(this, 'AdminUserPoolClientId', {
      value: adminAppClient.userPoolClientId,
      description: 'Admin Cognito App Client ID',
    });
    new cdk.CfnOutput(this, 'AdminLoginUrl', {
      value: `https://${adminUserPoolDomainPrefix}.auth.${props.region}.amazoncognito.com/login?client_id=${adminAppClient.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=${consoleDomain}`,
      description: 'Admin Cognito Hosted UI Login URL',
    });
    new cdk.CfnOutput(this, 'SyncAdminFnName', {
      value: syncAdminFn.functionName,
      description: 'Lambda function to sync admin credentials after password change',
    });
    new cdk.CfnOutput(this, 'AdminBuildProjectName', {
      value: adminBuildProject.projectName,
      description: 'CodeBuild project for Admin Console',
    });
  }
}
