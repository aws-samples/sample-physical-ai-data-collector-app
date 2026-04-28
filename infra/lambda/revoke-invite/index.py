import json
import os
import boto3

TABLE_NAME = os.environ['TABLE_NAME']
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)


def handler(event, context):
    token = (event.get('pathParameters') or {}).get('token', '').strip()
    if not token:
        return _resp(400, {'error': 'token path parameter is required'})

    result = table.get_item(Key={'pk': token})
    if not result.get('Item'):
        return _resp(404, {'error': 'Invite token not found'})

    try:
        table.update_item(
            Key={'pk': token},
            UpdateExpression='SET isActive = :false',
            ExpressionAttributeValues={':false': False},
        )
    except Exception as e:
        print(f'Update error: {e}')
        return _resp(500, {'error': 'Internal server error'})

    return _resp(200, {'message': 'Invite token revoked successfully'})


def _resp(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body),
    }
