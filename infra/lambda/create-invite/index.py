import boto3
import json
import os
import secrets
import time

ddb = boto3.client('dynamodb')
TABLE = os.environ['INVITE_TABLE']


def handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}')
    except (json.JSONDecodeError, TypeError):
        return _err(400, 'Invalid JSON body')

    workspace_name = body.get('workspaceName', '').strip()
    org_name = body.get('orgName', '').strip()
    if not workspace_name or not org_name:
        return _err(400, 'workspaceName and orgName are required')

    # Time window in hours (default 7 days)
    time_window_hours = int(body.get('timeWindowHours', 168))
    expires_at = int(time.time()) + time_window_hours * 3600

    max_uses = int(body.get('maxUses', 0))
    require_email_verification = bool(body.get('requireEmailVerification', False))
    daily_quota_gb = float(body.get('dailyQuotaGB', 0))
    total_quota_gb = float(body.get('totalQuotaGB', 0))

    # QR config: extra fields the app needs (optional, admin provides)
    region = body.get('region', os.environ.get('REGION', 'ap-northeast-2'))
    bucket_name = body.get('bucketName', '')
    bucket_prefix = body.get('bucketPrefix', '').strip('/')
    user_pool_id = body.get('userPoolId', '')
    user_pool_client_id = body.get('userPoolClientId', '')
    identity_pool_id = body.get('identityPoolId', '')
    invite_api_endpoint = body.get('inviteApiEndpoint', os.environ.get('INVITE_API_ENDPOINT', ''))

    token = 'grp_' + secrets.token_urlsafe(12)
    now = int(time.time())

    item = {
        'pk':                       {'S': token},
        'workspaceName':            {'S': workspace_name},
        'orgName':                  {'S': org_name},
        'expiresAt':                {'N': str(expires_at)},
        'maxUses':                  {'N': str(max_uses)},
        'usedCount':                {'N': '0'},
        'isActive':                 {'BOOL': True},
        'requireEmailVerification': {'BOOL': require_email_verification},
        'dailyQuotaGB':             {'N': str(daily_quota_gb)},
        'totalQuotaGB':             {'N': str(total_quota_gb)},
        'createdAt':                {'N': str(now)},
        # QR payload fields
        'region':                   {'S': region},
        'bucketName':               {'S': bucket_name},
        'bucketPrefix':             {'S': bucket_prefix},
        'userPoolId':               {'S': user_pool_id},
        'userPoolClientId':         {'S': user_pool_client_id},
        'identityPoolId':           {'S': identity_pool_id},
        'inviteApiEndpoint':        {'S': invite_api_endpoint},
    }

    ddb.put_item(TableName=TABLE, Item=item)

    qr_payload = {
        'workspaceName':            workspace_name,
        'orgName':                  org_name,
        'region':                   region,
        'bucketName':               bucket_name,
        'bucketPrefix':             bucket_prefix,
        'userPoolId':               user_pool_id,
        'userPoolClientId':         user_pool_client_id,
        'identityPoolId':           identity_pool_id,
        'inviteApiEndpoint':        invite_api_endpoint,
        'inviteToken':              token,
        'expiresAt':                _iso(expires_at),
        'requireEmailVerification': require_email_verification,
    }

    return {
        'statusCode': 201,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({
            'token':      token,
            'expiresAt':  expires_at,
            'qrPayload':  qr_payload,
        }),
    }


def _err(code, msg):
    return {
        'statusCode': code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'error': msg}),
    }


def _iso(ts):
    import datetime
    return datetime.datetime.utcfromtimestamp(ts).strftime('%Y-%m-%dT%H:%M:%SZ')
