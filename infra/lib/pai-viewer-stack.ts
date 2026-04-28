import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PAIViewerStackProps extends cdk.NestedStackProps {
  table: dynamodb.ITable;
  dataBucket: s3.IBucket;
  userPool: cognito.IUserPool;
  region: string;
}

export class PAIViewerStack extends cdk.NestedStack {
  public readonly distributionUrl: string;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: PAIViewerStackProps) {
    super(scope, id, props);

    const { table, dataBucket } = props;

    // ── S3: Webapp Hosting ────────────────────────────────────────────────
    const webappBucket = new s3.Bucket(this, 'ViewerWebapp', {
      bucketName: `pai-viewer-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // S3 bucket for build source code
    const sourceBucket = new s3.Bucket(this, 'ViewerSourceBucket', {
      bucketName: `pai-viewer-source-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
    });

    // ── Origin Access Control (OAC) ────────────────────────────────────────
    // Modern SigV4-based authentication (replaces legacy OAI)
    const oac = new cloudfront.CfnOriginAccessControl(this, 'ViewerOAC', {
      originAccessControlConfig: {
        name: 'PAIViewerOAC',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        description: 'OAC for PAI Viewer S3 origin',
      },
    });

    // ── CloudFront Distribution (L1 for OAC support) ───────────────────────
    const distribution = new cloudfront.CfnDistribution(this, 'ViewerDistribution', {
      distributionConfig: {
        enabled: true,
        defaultRootObject: 'index.html',
        priceClass: 'PriceClass_100',
        httpVersion: 'http2',
        comment: 'PAI Data Viewer',

        origins: [
          {
            id: 'S3Origin',
            domainName: webappBucket.bucketRegionalDomainName,
            s3OriginConfig: {
              originAccessIdentity: '', // Empty when using OAC
            },
            originAccessControlId: oac.ref,
          },
        ],

        defaultCacheBehavior: {
          targetOriginId: 'S3Origin',
          viewerProtocolPolicy: 'redirect-to-https',
          cachePolicyId: cloudfront.CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
          compress: true,
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD'],
        },

        // SPA client-side routing: 403/404 → index.html
        customErrorResponses: [
          {
            errorCode: 403,
            responseCode: 200,
            responsePagePath: '/index.html',
            errorCachingMinTtl: 0,
          },
          {
            errorCode: 404,
            responseCode: 200,
            responsePagePath: '/index.html',
            errorCachingMinTtl: 0,
          },
        ],

        viewerCertificate: {
          cloudFrontDefaultCertificate: true,
        },
      },
    });

    // S3 bucket policy: Allow CloudFront OAC to read objects
    webappBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontOACRead',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [`${webappBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.ref}`,
          },
        },
      })
    );

    // ── Cognito: Web Viewer Client ────────────────────────────────────────
    // Create separate UserPoolClient for web viewer with OAuth
    // (Android app uses separate client without OAuth)
    const distributionDomain = `https://${distribution.attrDomainName}`;
    
    const viewerClient = new cognito.UserPoolClient(this, 'ViewerClient', {
      userPool: props.userPool,
      userPoolClientName: 'pai-viewer-web',
      generateSecret: false,  // SPAs cannot keep secrets
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          `${distributionDomain}/callback`,
          `${distributionDomain}`,
          'http://localhost:5173/callback',
          'http://localhost:5173',
        ],
        logoutUrls: [
          `${distributionDomain}`,
          'http://localhost:5173',
        ],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // Cognito Hosted UI domain
    const domainPrefix = `pai-viewer-${this.account}`.substring(0, 63); // Max 63 chars
    const userPoolDomain = new cognito.UserPoolDomain(this, 'ViewerDomain', {
      userPool: props.userPool,
      cognitoDomain: {
        domainPrefix: domainPrefix,
      },
    });

    // ── Lambda Functions ───────────────────────────────────────────────────
    const pythonRuntime = lambda.Runtime.PYTHON_3_12;
    const lambdaTimeout = cdk.Duration.seconds(30);

    // List Captures
    const listCapturesFn = new lambda.Function(this, 'ListCapturesFn', {
      runtime: pythonRuntime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/list-captures'),
      environment: { TABLE_NAME: table.tableName, ALLOWED_ORIGIN: distributionDomain },
      timeout: lambdaTimeout,
    });
    table.grantReadData(listCapturesFn);

    // Get Video URL (presigned)
    const getVideoUrlFn = new lambda.Function(this, 'GetVideoUrlFn', {
      runtime: pythonRuntime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/get-video-url'),
      environment: { BUCKET_NAME: dataBucket.bucketName, ALLOWED_ORIGIN: distributionDomain },
      timeout: cdk.Duration.seconds(10),
    });
    dataBucket.grantRead(getVideoUrlFn);

    // Get Sensor Data (extract from ZIP)
    const getSensorDataFn = new lambda.Function(this, 'GetSensorDataFn', {
      runtime: pythonRuntime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/get-sensor-data'),
      environment: {
        BUCKET_NAME: dataBucket.bucketName,
        TABLE_NAME: table.tableName,
        ALLOWED_ORIGIN: distributionDomain,
      },
      timeout: lambdaTimeout,
    });
    dataBucket.grantRead(getSensorDataFn);
    table.grantReadData(getSensorDataFn);

    // Get Labels
    const getLabelsFn = new lambda.Function(this, 'GetLabelsFn', {
      runtime: pythonRuntime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/get-labels'),
      environment: { TABLE_NAME: table.tableName, ALLOWED_ORIGIN: distributionDomain },
      timeout: cdk.Duration.seconds(10),
    });
    table.grantReadData(getLabelsFn);

    // Update Labels
    const updateLabelsFn = new lambda.Function(this, 'UpdateLabelsFn', {
      runtime: pythonRuntime,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/update-labels'),
      environment: { TABLE_NAME: table.tableName, ALLOWED_ORIGIN: distributionDomain },
      timeout: cdk.Duration.seconds(10),
    });
    table.grantReadWriteData(updateLabelsFn);

    // ── API Gateway ────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'ViewerApi', {
      restApiName: 'PAI Viewer API',
      description: 'API for PAI Data Viewer - read captures, videos, sensor data, and labels',
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [distributionDomain, 'http://localhost:5173'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      binaryMediaTypes: ['application/octet-stream'],
    });

    // Cognito authorizer for API Gateway
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ViewerAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'ViewerCognitoAuth',
      identitySource: 'method.request.header.Authorization',
    });

    // API structure: /api/captures
    const apiResource = api.root.addResource('api');
    const captures = apiResource.addResource('captures');
    
    // GET /api/captures (list with optional filters) - requires auth
    captures.addMethod('GET', new apigateway.LambdaIntegration(listCapturesFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /api/captures/{id}
    const captureById = captures.addResource('{id}');
    
    // GET /api/captures/{id}/video - requires auth
    const video = captureById.addResource('video');
    video.addMethod('GET', new apigateway.LambdaIntegration(getVideoUrlFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /api/captures/{id}/sensor-data - requires auth
    const sensorData = captureById.addResource('sensor-data');
    sensorData.addMethod('GET', new apigateway.LambdaIntegration(getSensorDataFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /api/captures/{id}/labels - requires auth
    // PUT /api/captures/{id}/labels - requires auth
    const labels = captureById.addResource('labels');
    labels.addMethod('GET', new apigateway.LambdaIntegration(getLabelsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    labels.addMethod('PUT', new apigateway.LambdaIntegration(updateLabelsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ── CodeBuild: Deploy Webapp ───────────────────────────────────────────
    const buildProject = new codebuild.Project(this, 'ViewerBuildProject', {
      projectName: `${this.stackName}-viewer-build`,
      description: 'Build and deploy PAI Viewer webapp to S3/CloudFront',
      source: codebuild.Source.s3({ bucket: sourceBucket, path: '' }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        VITE_API_BASE_URL: { value: api.url },
        VITE_USER_POOL_ID: { value: props.userPool.userPoolId },
        VITE_USER_POOL_CLIENT_ID: { value: viewerClient.userPoolClientId },
        VITE_USER_POOL_DOMAIN: { value: `https://${domainPrefix}.auth.${props.region}.amazoncognito.com` },
        VITE_OAUTH_REDIRECT_URI: { value: distributionDomain },
        VITE_REGION: { value: props.region },
        WEBAPP_BUCKET: { value: webappBucket.bucketName },
        DISTRIBUTION_ID: { value: distribution.ref },
        DEPLOY_REGION: { value: this.region },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: '20' },
            commands: [
              'echo "Installing dependencies..."',
              'npm i',
            ],
          },
          build: {
            commands: [
              'echo "Building webapp with Vite..."',
              'echo "VITE_API_BASE_URL=$VITE_API_BASE_URL" > .env.production',
              'echo "VITE_USER_POOL_ID=$VITE_USER_POOL_ID" >> .env.production',
              'echo "VITE_USER_POOL_CLIENT_ID=$VITE_USER_POOL_CLIENT_ID" >> .env.production',
              'echo "VITE_USER_POOL_DOMAIN=$VITE_USER_POOL_DOMAIN" >> .env.production',
              'echo "VITE_OAUTH_REDIRECT_URI=$VITE_OAUTH_REDIRECT_URI" >> .env.production',
              'echo "VITE_REGION=$VITE_REGION" >> .env.production',
              'cat .env.production',
              'npm run build',
              'echo "Build artifacts in  dist/"',
            ],
          },
          post_build: {
            commands: [
              'echo "Syncing to S3..."',
              'aws s3 sync dist/ s3://$WEBAPP_BUCKET/ --region $DEPLOY_REGION --delete --cache-control "max-age=31536000,immutable"',
              'aws s3 cp dist/index.html s3://$WEBAPP_BUCKET/index.html --region $DEPLOY_REGION --cache-control "no-cache, no-store, must-revalidate"',
              'echo "Invalidating CloudFront..."',
              'aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"',
              'echo "✓ Deployment complete!"',
            ],
          },
        },
        cache: { paths: ['node_modules/**/*'] },
      }),
      timeout: cdk.Duration.minutes(20),
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
    });

    // Grant permissions to CodeBuild
    sourceBucket.grantRead(buildProject);
    webappBucket.grantReadWrite(buildProject);
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.ref}`,
        ],
      })
    );

    // ── Custom Resource: Trigger build on every CDK deploy ───────────────
    // (replaces S3 event trigger — avoids infinite loop from BucketDeployment)
    const triggerInitialBuildFn = new lambda.Function(this, 'TriggerInitialBuildFn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
import boto3, json, urllib.request

def handler(event, context):
    print(json.dumps(event))
    if event['RequestType'] in ('Create', 'Update'):
        cb = boto3.client('codebuild')
        project = event['ResourceProperties']['ProjectName']
        try:
            resp = cb.start_build(projectName=project)
            build_id = resp['build']['id']
            print(f"Build started: {build_id}")
            send(event, context, 'SUCCESS', {'BuildId': build_id}, build_id)
        except Exception as e:
            print(f"Error starting build: {str(e)}")
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

    triggerInitialBuildFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['codebuild:StartBuild'],
        resources: [buildProject.projectArn],
      })
    );

    // CustomResource fires after stack creation, triggering the initial build
    new CustomResource(this, 'InitialBuildTrigger', {
      serviceToken: triggerInitialBuildFn.functionArn,
      properties: {
        ProjectName: buildProject.projectName,
        // Hash of viewer/src files — changes automatically trigger rebuild on CDK deploy
        BuildVersion: cdk.FileSystem.fingerprint(path.join(__dirname, '../viewer/src')).substring(0, 12),
      },
    });

    // ── Deploy Source to S3 ────────────────────────────────────────────────
    // Upload only source files — exclude node_modules/dist/lock files so we
    // don't flood S3 with thousands of objects (which would re-trigger builds).
    // CodeBuild runs its own `npm install` from scratch.
    new s3deploy.BucketDeployment(this, 'DeployViewerSource', {
      sources: [s3deploy.Source.asset('./viewer', {
        exclude: [
          'node_modules/**',
          'dist/**',
          '.env*',
          'package-lock.json',
          'yarn.lock',
          'pnpm-lock.yaml',
        ],
      })],
      destinationBucket: sourceBucket,
      prune: true,
    });

    // ── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ViewerUrl', {
      value: `https://${distribution.attrDomainName}`,
      description: 'Viewer Webapp URL (CloudFront)',
      exportName: 'PAIViewerUrl',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
      exportName: 'PAIViewerApiUrl',
    });

    new cdk.CfnOutput(this, 'CognitoLoginUrl', {
      value: `https://${domainPrefix}.auth.${props.region}.amazoncognito.com/login?client_id=${viewerClient.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=${distributionDomain}`,
      description: 'Cognito Hosted UI Login URL',
    });

    new cdk.CfnOutput(this, 'ViewerUserPoolClientId', {
      value: viewerClient.userPoolClientId,
      description: 'Cognito User Pool Client ID for Web Viewer',
    });

    new cdk.CfnOutput(this, 'WebappBucket', {
      value: webappBucket.bucketName,
      description: 'S3 bucket for webapp hosting',
    });

    new cdk.CfnOutput(this, 'SourceBucket', {
      value: sourceBucket.bucketName,
      description: 'S3 bucket for source code (auto-uploaded during CDK deploy)',
    });

    new cdk.CfnOutput(this, 'BuildProjectName', {
      value: buildProject.projectName,
      description: 'CodeBuild project name for webapp deployment',
    });

    this.distributionUrl = `https://${distribution.attrDomainName}`;
    this.apiUrl = api.url;
  }
}
