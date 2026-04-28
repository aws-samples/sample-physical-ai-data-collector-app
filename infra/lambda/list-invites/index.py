import boto3
import json
import os
import time

ddb = boto3.client('dynamodb')
TABLE = os.environ['INVITE_TABLE']


def handler(event, context):
    qp = event.get('queryStringParameters') or {}
    include_expired = qp.get('includeExpired', 'false').lower() == 'true'
    include_inactive = qp.get('includeInactive', 'false').lower() == 'true'

    result = ddb.scan(TableName=TABLE)
    items = result.get('Items', [])

    # Continue scanning if paginated
    while 'LastEvaluatedKey' in result:
        result = ddb.scan(TableName=TABLE, ExclusiveStartKey=result['LastEvaluatedKey'])
        items.extend(result.get('Items', []))

    now = int(time.time())
    invites = []
    for item in items:
        expires_at = int(item.get('expiresAt', {}).get('N', '0'))
        is_active = item.get('isActive', {}).get('BOOL', False)
        is_expired = expires_at > 0 and expires_at < now

        if is_expired and not include_expired:
            continue
        if not is_active and not include_inactive:
            continue

        invites.append({
            'token':                    item['pk']['S'],
            'workspaceName':            item.get('workspaceName', {}).get('S', ''),
            'orgName':                  item.get('orgName', {}).get('S', ''),
            'expiresAt':                expires_at,
            'maxUses':                  int(item.get('maxUses', {}).get('N', '0')),
            'usedCount':                int(item.get('usedCount', {}).get('N', '0')),
            'isActive':                 is_active,
            'isExpired':                is_expired,
            'requireEmailVerification': item.get('requireEmailVerification', {}).get('BOOL', False),
            'dailyQuotaGB':             float(item.get('dailyQuotaGB', {}).get('N', '0')),
            'totalQuotaGB':             float(item.get('totalQuotaGB', {}).get('N', '0')),
            'createdAt':                int(item.get('createdAt', {}).get('N', '0')),
            'region':                   item.get('region', {}).get('S', ''),
            'bucketName':               item.get('bucketName', {}).get('S', ''),
            'bucketPrefix':             item.get('bucketPrefix', {}).get('S', ''),
            'userPoolId':               item.get('userPoolId', {}).get('S', ''),
            'userPoolClientId':         item.get('userPoolClientId', {}).get('S', ''),
            'identityPoolId':           item.get('identityPoolId', {}).get('S', ''),
            'inviteApiEndpoint':        item.get('inviteApiEndpoint', {}).get('S', ''),
        })

    # Sort by createdAt descending
    invites.sort(key=lambda x: x['createdAt'], reverse=True)

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'invites': invites, 'count': len(invites)}),
    }
