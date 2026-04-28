import json
import os
import boto3
from urllib.parse import unquote

s3_client = boto3.client('s3')
BUCKET_NAME = os.environ['BUCKET_NAME']
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
    """Generate presigned URL for video file - validates user ownership"""
    cors_origin = get_cors_origin(event)
    try:
        # Get authenticated user's Cognito sub
        user_sub = get_user_sub(event)
        
        capture_id = unquote(event['pathParameters']['id'])

        # Validate that the capture ID belongs to this user
        if not capture_id.startswith(f'data/{user_sub}'):
            return {
                'statusCode': 403,
                'headers': {'Access-Control-Allow-Origin': cors_origin},
                'body': json.dumps({'error': 'Access denied'})
            }
        
        # Convert data key to video key: data/{sub}/... → video/{sub}/...
        # Only replace the first 'data/' prefix, not inner path segments
        video_key = capture_id.replace('data/', 'video/', 1).replace('_data.zip', '.mp4')
    except ValueError:
        return {
            'statusCode': 401,
            'headers': {'Access-Control-Allow-Origin': cors_origin},
            'body': json.dumps({'error': 'Unauthorized'})
        }
    
    try:
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': video_key
            },
            ExpiresIn=3600  # 1 hour
        )
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
            },
            'body': json.dumps({
                'url': url,
                'expiresIn': 3600
            })
        }
    except Exception as e:
        print(f'Error generating presigned URL: {str(e)}')
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': cors_origin},
            'body': json.dumps({'error': str(e)})
        }
