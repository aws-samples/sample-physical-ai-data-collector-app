import json
import os
import time
import boto3
from boto3.dynamodb.conditions import Attr

TABLE_NAME = os.environ['TABLE_NAME']
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)


def handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}')
        token = body.get('inviteToken', '').strip()
    except (json.JSONDecodeError, AttributeError):
        return _resp(400, {'error': 'Invalid request body'})

    if not token:
        return _resp(400, {'error': 'inviteToken is required'})

    now = int(time.time())

    try:
        result = table.get_item(Key={'pk': token})
    except Exception as e:
        print(f'DynamoDB error: {e}')
        return _resp(500, {'error': 'Internal server error'})

    item = result.get('Item')

    if not item:
        return _resp(403, {'error': 'Invalid invite token'})

    if not item.get('isActive', False):
        return _resp(403, {'error': 'Invite token has been revoked'})

    expires_at = item.get('expiresAt', 0)
    if expires_at > 0 and expires_at < now:
        return _resp(403, {'error': 'Invite token has expired'})

    max_uses = item.get('maxUses', 0)
    used_count = item.get('usedCount', 0)
    if max_uses > 0 and used_count >= max_uses:
        return _resp(403, {'error': 'Invite token usage limit exceeded'})

    # Atomic increment usedCount
    try:
        table.update_item(
            Key={'pk': token},
            UpdateExpression='SET usedCount = usedCount + :inc',
            ConditionExpression=(
                Attr('isActive').eq(True) &
                (Attr('expiresAt').not_exists() | Attr('expiresAt').lte(0) | Attr('expiresAt').gt(now))
            ),
            ExpressionAttributeValues={':inc': 1},
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        return _resp(403, {'error': 'Invite token is no longer valid'})
    except Exception as e:
        print(f'Update error: {e}')
        return _resp(500, {'error': 'Internal server error'})

    workspace_config = {
        'workspaceName': item.get('workspaceName', ''),
        'orgName': item.get('orgName', ''),
        'requireEmailVerification': bool(item.get('requireEmailVerification', False)),
        'dailyQuotaGB': int(item.get('dailyQuotaGB', 0)),
        'totalQuotaGB': int(item.get('totalQuotaGB', 0)),
    }

    return _resp(200, {'workspaceConfig': workspace_config})


def _resp(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body),
    }
