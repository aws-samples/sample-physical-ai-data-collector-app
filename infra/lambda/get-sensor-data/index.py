import json
import os
import zipfile
import io
import csv
import boto3
from decimal import Decimal
from urllib.parse import unquote

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

BUCKET_NAME = os.environ['BUCKET_NAME']
TABLE_NAME = os.environ['TABLE_NAME']
ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN', '*')


def get_cors_origin(event):
    """Return the request origin if it's localhost (dev), else the configured production origin."""
    origin = (event.get('headers') or {}).get('origin') or (event.get('headers') or {}).get('Origin', '')
    if origin.startswith(('http://localhost:', 'http://127.0.0.1:')):
        return origin
    return ALLOWED_ORIGIN


def parse_csv_to_compact_json(csv_content, captured_at):
    """Convert CSV to compact JSON array format — all 30 columns.

    Array index layout per row:
        0           : timestampMs
        1-3         : accel_x/y/z
        4-6         : gyro_x/y/z
        7-9         : mag_x/y/z
        10-12       : gravity_x/y/z
        13-15       : linear_accel_x/y/z
        16-19       : rot_x/y/z/w
        20          : rot_heading_accuracy
        21          : pressure
        22          : light
        23          : proximity
        24-26       : lat/lng/alt
        27          : speed
        28          : bearing
        29          : gps_accuracy
    """
    reader = csv.DictReader(io.StringIO(csv_content))
    data = []

    def _f(row, key):
        v = row.get(key, '')
        return float(v) if v not in ('', None) else 0.0

    def _i(row, key):
        v = row.get(key, '')
        return int(float(v)) if v not in ('', None) else 0

    for row in reader:
        try:
            data.append([
                _i(row, 'timestampMs'),
                # accelerometer
                _f(row, 'accel_x'), _f(row, 'accel_y'), _f(row, 'accel_z'),
                # gyroscope
                _f(row, 'gyro_x'),  _f(row, 'gyro_y'),  _f(row, 'gyro_z'),
                # magnetometer
                _f(row, 'mag_x'),   _f(row, 'mag_y'),   _f(row, 'mag_z'),
                # gravity
                _f(row, 'gravity_x'), _f(row, 'gravity_y'), _f(row, 'gravity_z'),
                # linear acceleration
                _f(row, 'linear_accel_x'), _f(row, 'linear_accel_y'), _f(row, 'linear_accel_z'),
                # rotation vector (quaternion)
                _f(row, 'rot_x'), _f(row, 'rot_y'), _f(row, 'rot_z'), _f(row, 'rot_w'),
                # rotation heading accuracy
                _f(row, 'rot_heading_accuracy'),
                # environmental
                _f(row, 'pressure'), _f(row, 'light'), _f(row, 'proximity'),
                # GPS
                _f(row, 'lat'), _f(row, 'lng'), _f(row, 'alt'),
                _f(row, 'speed'), _f(row, 'bearing'), _f(row, 'gps_accuracy'),
            ])
        except (ValueError, KeyError) as e:
            print(f'Skipping invalid row: {e}')
            continue

    return {
        'start': captured_at,
        'rate': 100,  # Hz - assumes 100Hz sampling
        'data': data
    }


def get_user_sub(event):
    """Extract Cognito user sub from API Gateway authorizer"""
    try:
        return event['requestContext']['authorizer']['claims']['sub']
    except (KeyError, TypeError):
        raise ValueError('Missing or invalid Cognito claims')


def handler(event, context):
    """Extract sensor.csv from ZIP and return as compact JSON - validates user ownership"""
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
        # Get metadata from DynamoDB for capturedAt timestamp
        table = dynamodb.Table(TABLE_NAME)
        response = table.get_item(Key={'pk': capture_id})
        
        item = response.get('Item', {})
        captured_at = int(item.get('capturedAt', 0))
        
        # Download ZIP from S3
        s3_response = s3_client.get_object(Bucket=BUCKET_NAME, Key=capture_id)
        zip_data = s3_response['Body'].read()
        
        # Extract sensor.csv from ZIP
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            if 'sensor.csv' not in zf.namelist():
                return {
                    'statusCode': 404,
                    'headers': {'Access-Control-Allow-Origin': cors_origin},
                    'body': json.dumps({'error': 'sensor.csv not found in ZIP'})
                }
            
            with zf.open('sensor.csv') as csv_file:
                csv_content = csv_file.read().decode('utf-8')
        
        # Convert to compact JSON
        compact_data = parse_csv_to_compact_json(csv_content, captured_at)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': cors_origin,
            },
            'body': json.dumps(compact_data)
        }
        
    except Exception as e:
        print(f'Error processing sensor data: {str(e)}')
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': cors_origin},
            'body': json.dumps({'error': str(e)})
        }
