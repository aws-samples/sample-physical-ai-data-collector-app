import json
import os
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['TABLE_NAME'])
ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN', '*')


def get_cors_origin(event):
    """Return the request origin if it's localhost (dev), else the configured production origin."""
    origin = (event.get('headers') or {}).get('origin') or (event.get('headers') or {}).get('Origin', '')
    if origin.startswith(('http://localhost:', 'http://127.0.0.1:')):
        return origin
    return ALLOWED_ORIGIN


def decimal_default(obj):
    """JSON serializer for Decimal objects"""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError


def get_user_sub(event):
    """Extract Cognito user sub from API Gateway authorizer"""
    try:
        return event['requestContext']['authorizer']['claims']['sub']
    except (KeyError, TypeError):
        raise ValueError('Missing or invalid Cognito claims')


def handler(event, context):
    """List captures with optional filtering - filtered by user's Cognito sub"""
    cors_origin = get_cors_origin(event)
    params = event.get('queryStringParameters') or {}
    status = params.get('status')
    scenario = params.get('scenario')
    limit = int(params.get('limit', 50))
    
    try:
        # Get authenticated user's Cognito sub
        user_sub = get_user_sub(event)
        print(f'Listing captures for user: {user_sub}')
        
        # S3 keys follow pattern: data/{cognitoSub}*/...
        # Filter to only show user's own data
        if scenario:
            # Query by scenario GSI, then filter by user
            response = table.query(
                IndexName='scenario-index',
                KeyConditionExpression='scenario = :scenario',
                FilterExpression='begins_with(pk, :user_prefix)',
                ExpressionAttributeValues={
                    ':scenario': scenario,
                    ':user_prefix': f'data/{user_sub}'
                },
                Limit=limit,
                ScanIndexForward=False
            )
        elif status:
            # Scan with status filter + user filter
            response = table.scan(
                FilterExpression='(labelStatus = :status OR attribute_not_exists(labelStatus)) AND begins_with(pk, :user_prefix)',
                ExpressionAttributeValues={
                    ':status': status,
                    ':user_prefix': f'data/{user_sub}'
                },
                Limit=limit
            )
        else:
            # Scan filtered by user
            response = table.scan(
                FilterExpression='begins_with(pk, :user_prefix)',
                ExpressionAttributeValues={':user_prefix': f'data/{user_sub}'},
                Limit=limit
            )
        
        items = response.get('Items', [])
        print(f'Found {len(items)} items for user {user_sub}')
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
            },
            'body': json.dumps({
                'items': items,
                'count': len(items)
            }, default=decimal_default)
        }
    except ValueError as e:
        print(f'Authentication error: {str(e)}')
        return {
            'statusCode': 401,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'Unauthorized'})
        }
    except Exception as e:
        print(f'Error: {str(e)}')
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
