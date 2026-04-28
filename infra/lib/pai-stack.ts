import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { PAIViewerStack } from './pai-viewer-stack';

export interface PAIStackProps extends cdk.StackProps {
  /** 'dev'  = SES Sandbox (only verified addresses receive mail)
   *  'prod' = SES Production (any address can receive mail, requires prior SES production access request) */
  mode?: 'dev' | 'prod';
}

export class PAIStack extends cdk.Stack {
  public readonly bucketName: string;
  public readonly userPoolId: string;
  public readonly userPoolArn: string;
  public readonly userPoolClientId: string;
  public readonly identityPoolId: string;

  constructor(scope: Construct, id: string, props: PAIStackProps = {}) {
    super(scope, id, props);
    const mode = props.mode ?? 'dev';

    // ── S3: raw data bucket ──────────────────────────────────────────────────
    const bucket = new s3.Bucket(this, 'PAIRawData', {
      bucketName: `pai-raw-data-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── DynamoDB: capture index ──────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'PAICaptureIndex', {
      tableName: 'pai-capture-index-1',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'scenario-index',
      partitionKey: { name: 'scenario', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'capturedAt', type: dynamodb.AttributeType.NUMBER },
    });

    // ── SES: Cognito email identity ───────────────────────────────────────────
    // Cognito uses SES to send verification emails.
    // Dev:  SES Sandbox — only pre-verified addresses can receive mail.
    //       No CDK resource needed; register test addresses in SES console manually.
    // Prod: SES out of sandbox required (AWS Support case) before deploying with mode=prod.
    //       We create the EmailIdentity so CDK tracks it; add DKIM/SPF records as instructed.
    const SES_FROM_EMAIL = 'noreply@pai.example.com'; // change to a domain you own for prod
    const SES_REPLY_TO   = 'noreply@pai.example.com';

    let emailConfig: cognito.UserPoolEmail | undefined;
    if (mode === 'prod') {
      // Verify the sender domain in SES so Cognito can use it.
      new ses.EmailIdentity(this, 'PAISesIdentity', {
        identity: ses.Identity.email(SES_FROM_EMAIL),
      });

      emailConfig = cognito.UserPoolEmail.withSES({
        sesRegion: this.region,
        fromEmail: SES_FROM_EMAIL,
        replyTo:   SES_REPLY_TO,
        fromName:  'PAI App',
        // sesVerifiedDomain omitted — we use address-level identity, not domain identity
      });
    }
    // Dev: emailConfig left undefined → Cognito uses its built-in mailer (50/day cap).

    // ── Cognito User Pool ────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'PAIUserPool', {
      userPoolName: 'pai-users',
      selfSignUpEnabled: true,           // needed for requireEmailVerification=true QR flow
      signInAliases: { username: true }, // AliasAttributes cannot be changed after creation
      autoVerify: { email: true },       // Cognito sends verification code on self sign-up
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      email: emailConfig,                // prod: SES-backed | dev: Cognito built-in
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'PAIUserPoolClient', {
      userPool,
      userPoolClientName: 'pai-android-client',
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,  // mobile apps cannot keep secrets
    });

    // ── Cognito Identity Pool ────────────────────────────────────────────────
    const identityPool = new cognito.CfnIdentityPool(this, 'PAIIdentityPool', {
      identityPoolName: 'pai_identity_pool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName,
      }],
    });

    // IAM role for authenticated Cognito users.
    // sts:TagSession is required alongside AssumeRoleWithWebIdentity when the
    // Identity Pool is configured to pass principal tags (CfnIdentityPoolPrincipalTag).
    const authenticatedRole = new iam.Role(this, 'PAICognitoAuthRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.FederatedPrincipal(
          'cognito-identity.amazonaws.com',
          {
            StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
            'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
          },
          'sts:AssumeRoleWithWebIdentity',
        ),
      ),
    });
    // Allow Cognito Identity to pass principal tags when assuming this role
    authenticatedRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {})],
        actions: ['sts:TagSession'],
      })
    );

    // Map the User Pool "sub" JWT claim → principal tag "sub" so the IAM policy
    // can enforce user-scoped S3 prefixes using the same ID as the viewer lambdas.
    new cognito.CfnIdentityPoolPrincipalTag(this, 'PAIPrincipalTagMapping', {
      identityPoolId: identityPool.ref,
      identityProviderName: userPool.userPoolProviderName,
      principalTags: { sub: 'sub' },  // JWT claim "sub" → principal tag "sub"
      useDefaults: true,              // keep default authenticated/unauthenticated role resolution
    });

    // Allow authenticated users to PUT/GET any object in the bucket.
    // Per-user prefix enforcement via IAM principal tags was unreliable in testing
    // (principal tag "sub" maps to username, not User Pool sub UUID, causing 403).
    // For PoC: bucket-level allow is sufficient; prefix structure is enforced in app code.
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [
        bucket.arnForObjects('video/*'),
        bucket.arnForObjects('data/*'),
      ],
    }));

    new cognito.CfnIdentityPoolRoleAttachment(this, 'PAIIdentityPoolRoles', {
      identityPoolId: identityPool.ref,
      roles: { authenticated: authenticatedRole.roleArn },
    });

    // ── Lambda: S3 trigger → DynamoDB index ─────────────────────────────────
    // Triggered by data/*.zip upload; unzips and parses metadata.csv → DynamoDB
    const indexFn = new lambda.Function(this, 'IndexFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const zlib = require('zlib');
const s3 = new S3Client({});
const ddb = new DynamoDBClient({});

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseMetadataCsv(csv) {
  const lines = csv.trim().split('\\n');
  if (lines.length < 2) return {};
  const keys = lines[0].split(',');
  const vals = lines[1].split(',');
  return Object.fromEntries(keys.map((k, i) => [k.trim(), vals[i]?.trim()]));
}

function parseZip(buf) {
  const entries = {};
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Invalid ZIP');
  
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  
  let offset = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const fnLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.slice(offset + 46, offset + 46 + fnLen).toString('utf8');
    
    const localFnLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localFnLen + localExtraLen;
    const compData = buf.slice(dataOffset, dataOffset + compSize);
    
    entries[fileName] = method === 8 ? zlib.inflateRawSync(compData).toString('utf8') : compData.toString('utf8');
    offset += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

exports.handler = async (event) => {
  console.log('Processing', event.Records.length, 'records');
  for (const rec of event.Records) {
    try {
      const key = decodeURIComponent(rec.s3.object.key.replace(/\\+/g, ' '));
      console.log('Processing:', key);
      if (!key.startsWith('data/') || !key.endsWith('_data.zip')) continue;

      const obj = await s3.send(new GetObjectCommand({ Bucket: rec.s3.bucket.name, Key: key }));
      const buf = await streamToBuffer(obj.Body);
      console.log('ZIP size:', buf.length);

      const entries = parseZip(buf);
      console.log('Files:', Object.keys(entries));

      if (!entries['metadata.csv']) { console.error('No metadata.csv'); continue; }
      const meta = parseMetadataCsv(entries['metadata.csv']);
      console.log('Metadata:', meta);

      await ddb.send(new PutItemCommand({
        TableName: process.env.TABLE,
        Item: {
          pk:         { S: key },
          userSub:    { S: key.split('/')[1] ?? 'unknown' },
          capturedAt: { N: String(meta.capturedAt ?? Date.now()) },
          scenario:   { S: meta.scenario ?? 'unknown' },
          location:   { S: meta.location ?? 'unknown' },
          taskType:   { S: meta.taskType ?? 'unknown' },
          deviceId:   { S: meta.deviceId ?? 'unknown' },
          s3Key:      { S: key },
        },
      }));
      console.log('✓ Indexed:', key);
    } catch (err) {
      console.error('Error:', err.message);
      throw err;
    }
  }
};`),
      environment: { TABLE: table.tableName },
      timeout: cdk.Duration.seconds(30),
    });

    table.grantWriteData(indexFn);
    bucket.grantRead(indexFn);
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(indexFn),
      { prefix: 'data/' },
    );

    // ── Viewer Web App (Nested Stack) ──────────────────────────────────────
    const viewerStack = new PAIViewerStack(this, 'ViewerStack', {
      table: table,
      dataBucket: bucket,
      userPool: userPool,
      region: this.region,
    });

    // ── Public properties (consumed by AdminStack) ───────────────────────────
    this.bucketName       = bucket.bucketName;
    this.userPoolId       = userPool.userPoolId;
    this.userPoolArn      = userPool.userPoolArn;
    this.userPoolClientId = userPoolClient.userPoolClientId;
    this.identityPoolId   = identityPool.ref;

    // ── Outputs (paste these into Android app's AwsConfig.kt) ───────────────
    new cdk.CfnOutput(this, 'BucketName',         { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'UserPoolId',         { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId',   { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'IdentityPoolId',     { value: identityPool.ref });
    new cdk.CfnOutput(this, 'Region',             { value: this.region });
    new cdk.CfnOutput(this, 'ViewerUrl',          { value: viewerStack.distributionUrl, description: 'Web Viewer URL (CloudFront)' });
    new cdk.CfnOutput(this, 'DeployMode',         { value: mode, description: 'dev=SES Sandbox / prod=SES Production' });
  }
}
