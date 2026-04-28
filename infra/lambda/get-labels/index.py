import json
import os
import boto3
from decimal import Decimal
from urllib.parse import unquote

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ['TABLE_NAME']
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
    """Get labels for a capture - validates user ownership"""
    cors_origin = get_cors_origin(event)
    try:
        user_sub = get_user_sub(event)
        capture_id = unquote(event['pathParameters']['id'])

        # Validate user ownership
        if not capture_id.startswith(f'data/{user_sub}'):
            return {
                'statusCode': 403,
                'headers': {'Access-Control-Allow-Origin': cors_origin},
                'body': json.dumps({'error': 'Access denied'})
            }
    except ValueError:
        return {
            'statusCode': 401,
            'headers': {'Access-Control-Allow-Origin': cors_origin},
            'body': json.dumps({'error': 'Unauthorized'})
        }
    
    try:
        table = dynamodb.Table(TABLE_NAME)
        response = table.get_item(Key={'pk': capture_id})
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'headers': {'Access-Control-Allow-Origin': cors_origin},
                'body': json.dumps({'error': 'Capture not found'})
            }
        
        item = response['Item']
        
        labels = {
            'quality': item.get('labelQuality'),
            'tags': item.get('labelTags', []),
            'issues': item.get('labelIssues', []),
            'notes': item.get('labelNotes', ''),
            'reviewer': item.get('labelReviewer'),
            'reviewedAt': item.get('labelReviewedAt'),
            'status': item.get('labelStatus', 'pending'),
        }
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
            },
            'body': json.dumps(labels, default=decimal_default)
        }
        
    except Exception as e:
        print(f'Error getting labels: {str(e)}')
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': cors_origin},
            'body': json.dumps({'error': str(e)})
        }
