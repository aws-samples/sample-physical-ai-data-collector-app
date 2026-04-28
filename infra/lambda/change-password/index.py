import boto3
import json
import os
import re

cognito = boto3.client('cognito-idp')
sm = boto3.client('secretsmanager')

SECRET_ARN   = os.environ['SECRET_ARN']
USER_POOL_ID = os.environ['ADMIN_USER_POOL_ID']
USERNAME     = os.environ.get('ADMIN_USERNAME', 'admin')

# Minimum: 12 chars, uppercase, digit, symbol (matches Cognito pool policy)
_MIN_LEN = 12
_STRONG  = re.compile(r'^(?=.*[A-Z])(?=.*\d)(?=.*[!#$%&*+,\-.;=?^_~]).{12,}$')


def handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}')
    except (json.JSONDecodeError, TypeError):
        return _err(400, 'Invalid JSON body')

    new_password = body.get('newPassword', '')
    if not new_password:
        return _err(400, 'newPassword is required')
    if len(new_password) < _MIN_LEN:
        return _err(400, f'Password must be at least {_MIN_LEN} characters')
    if not _STRONG.match(new_password):
        return _err(400, 'Password must contain uppercase, digit, and symbol')

    try:
        # 1) Update Cognito password
        cognito.admin_set_user_password(
            UserPoolId=USER_POOL_ID,
            Username=USERNAME,
            Password=new_password,
            Permanent=True,
        )

        # 2) Sync new password back to Secrets Manager
        current = json.loads(sm.get_secret_value(SecretId=SECRET_ARN)['SecretString'])
        current['password'] = new_password
        sm.put_secret_value(SecretId=SECRET_ARN, SecretString=json.dumps(current))

    except cognito.exceptions.InvalidPasswordException as e:
        return _err(400, f'Invalid password: {e}')
    except Exception as e:
        return _err(500, f'Failed to update password: {e}')

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'message': 'Password updated successfully'}),
    }


def _err(code, msg):
    return {
        'statusCode': code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'error': msg}),
    }
