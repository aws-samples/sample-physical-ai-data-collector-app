import json
import os
import time
import boto3

TABLE_NAME = os.environ['TABLE_NAME']
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)


def handler(event, context):
    token = (event.get('pathParameters') or {}).get('token', '').strip()
    if not token:
        return _resp(400, {'error': 'token path parameter is required'})

    try:
        body = json.loads(event.get('body') or '{}')
    except (json.JSONDecodeError, AttributeError):
        return _resp(400, {'error': 'Invalid request body'})

    # Check item exists
    result = table.get_item(Key={'pk': token})
    if not result.get('Item'):
        return _resp(404, {'error': 'Invite token not found'})

    update_expressions = []
    expression_values = {}

    new_expires_at = body.get('expiresAt')
    if new_expires_at is not None:
        if not isinstance(new_expires_at, int) or new_expires_at < 0:
            return _resp(400, {'error': 'expiresAt must be a non-negative Unix timestamp'})
        update_expressions.append('expiresAt = :ea')
        expression_values[':ea'] = new_expires_at

    additional_uses = body.get('additionalUses')
    if additional_uses is not None:
        if not isinstance(additional_uses, int) or additional_uses < 0:
            return _resp(400, {'error': 'additionalUses must be a non-negative integer'})
        update_expressions.append('maxUses = maxUses + :au')
        expression_values[':au'] = additional_uses

    is_active = body.get('isActive')
    if is_active is not None:
        update_expressions.append('isActive = :ia')
        expression_values[':ia'] = bool(is_active)

    if not update_expressions:
        return _resp(400, {'error': 'No fields to update'})

    try:
        table.update_item(
            Key={'pk': token},
            UpdateExpression='SET ' + ', '.join(update_expressions),
            ExpressionAttributeValues=expression_values,
        )
    except Exception as e:
        print(f'Update error: {e}')
        return _resp(500, {'error': 'Internal server error'})

    return _resp(200, {'message': 'Invite token updated successfully'})


def _resp(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body),
    }
