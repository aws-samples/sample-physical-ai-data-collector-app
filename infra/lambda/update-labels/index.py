import json
import os
import time
import boto3
from urllib.parse import unquote

dynamodb = boto3.client('dynamodb')
TABLE_NAME = os.environ['TABLE_NAME']
ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN', '*')


def get_cors_origin(event):
    """Return the request origin if it's localhost (dev), else the configured production origin."""
    origin = (event.get('headers') or {}).get('origin') or (event.get('headers') or {}).get('Origin', '')
    if origin.startswith(('http://localhost:', 'http://127.0.0.1:')):
        return origin
    return ALLOWED_ORIGIN


def get_user_sub(event):
    """Extract Cognito user sub from API Gateway authorizer"""
    try:
        return event['requestContext']['authorizer']['claims']['sub']
    except (KeyError, TypeError):
        raise ValueError('Missing or invalid Cognito claims')


def handler(event, context):
    """Update labels for a capture - validates user ownership"""
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
        
        body = json.loads(event.get('body', '{}'))
    except ValueError:
        return {
            'statusCode': 401,
            'headers': {'Access-Control-Allow-Origin': cors_origin},
            'body': json.dumps({'error': 'Unauthorized'})
        }
    
    try:
        # Build update expression
        update_parts = []
        expr_names = {}
        expr_values = {}
        
        if 'quality' in body:
            update_parts.append('#quality = :quality')
            expr_names['#quality'] = 'labelQuality'
            expr_values[':quality'] = {'S': body['quality']}
        
        if 'tags' in body:
            update_parts.append('#tags = :tags')
            expr_names['#tags'] = 'labelTags'
            expr_values[':tags'] = {'L': [{'S': tag} for tag in body['tags']]}
        
        if 'issues' in body:
            update_parts.append('#issues = :issues')
            expr_names['#issues'] = 'labelIssues'
            expr_values[':issues'] = {'L': [{'S': issue} for issue in body['issues']]}
        
        if 'notes' in body:
            update_parts.append('#notes = :notes')
            expr_names['#notes'] = 'labelNotes'
            expr_values[':notes'] = {'S': body['notes']}
        
        if 'reviewer' in body:
            update_parts.append('#reviewer = :reviewer')
            expr_names['#reviewer'] = 'labelReviewer'
            expr_values[':reviewer'] = {'S': body['reviewer']}
        
        if 'status' in body:
            update_parts.append('#status = :status')
            expr_names['#status'] = 'labelStatus'
            expr_values[':status'] = {'S': body['status']}
        
        # Always update reviewedAt timestamp
        update_parts.append('#reviewedAt = :reviewedAt')
        expr_names['#reviewedAt'] = 'labelReviewedAt'
        expr_values[':reviewedAt'] = {'N': str(int(time.time() * 1000))}
        
        if not update_parts:
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': cors_origin},
                'body': json.dumps({'error': 'No valid fields to update'})
            }
        
        # Update item in DynamoDB
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key={'pk': {'S': capture_id}},
            UpdateExpression='SET ' + ', '.join(update_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values
        )
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
            },
            'body': json.dumps({'success': True})
        }
        
    except Exception as e:
        print(f'Error updating labels: {str(e)}')
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': cors_origin},
            'body': json.dumps({'error': str(e)})
        }
