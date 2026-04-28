import boto3
import json
import os
import re

cognito = boto3.client('cognito-idp')
ses = boto3.client('ses', region_name=os.environ.get('SES_REGION', 'ap-northeast-2'))

USER_POOL_ID = os.environ['APP_USER_POOL_ID']
SES_FROM_EMAIL = os.environ.get('SES_FROM_EMAIL', '')

# Characters that are visually ambiguous are excluded: 0, O, 1, I, l
_UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'
_LOWER = 'abcdefghjkmnpqrstuvwxyz'
_DIGITS = '23456789'
_SYMBOLS = '!@#$'


def _cors_headers():
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    }


def _resp(status, body):
    return {'statusCode': status, 'headers': _cors_headers(), 'body': json.dumps(body)}


def _generate_temp_password():
    """Generate a 12-char password that is easy to read and type.
    Excludes visually ambiguous characters: 0, O, 1, I, l.
    Format: UPPER + DIGIT + SYMBOL + 9 alphanumeric chars.
    """
    import secrets
    alphabet = _UPPER + _LOWER + _DIGITS
    body = ''.join(secrets.choice(alphabet) for _ in range(9))
    pw = secrets.choice(_UPPER) + secrets.choice(_DIGITS) + secrets.choice(_SYMBOLS) + body
    # Shuffle so the guaranteed chars aren't always at the front
    pw_list = list(pw)
    secrets.SystemRandom().shuffle(pw_list)
    return ''.join(pw_list)


def handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        return _resp(400, {'error': 'Invalid JSON body'})

    email = (body.get('email') or '').strip().lower()
    if not email or not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        return _resp(400, {'error': 'Invalid email address'})

    try:
        cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {'Name': 'email', 'Value': email},
                {'Name': 'email_verified', 'Value': 'true'},
            ],
            MessageAction='SUPPRESS',
            DesiredDeliveryMediums=['EMAIL'],
        )
    except cognito.exceptions.UsernameExistsException:
        return _resp(409, {'error': 'EMAIL_EXISTS'})
    except Exception as e:
        return _resp(500, {'error': str(e)})

    temp_password = _generate_temp_password()

    try:
        cognito.admin_set_user_password(
            UserPoolId=USER_POOL_ID,
            Username=email,
            Password=temp_password,
            Permanent=False,  # Forces NEW_PASSWORD_REQUIRED on first login
        )
    except Exception as e:
        try:
            cognito.admin_delete_user(UserPoolId=USER_POOL_ID, Username=email)
        except Exception:
            pass
        return _resp(500, {'error': f'Failed to set temp password: {str(e)}'})

    if SES_FROM_EMAIL:
        try:
            ses.send_email(
                Source=SES_FROM_EMAIL,
                Destination={'ToAddresses': [email]},
                Message={
                    'Subject': {'Data': '[PAI Data Collector] Your temporary password', 'Charset': 'UTF-8'},
                    'Body': {
                        'Text': {
                            'Data': (
                                f'Hello,\n\n'
                                f'You have been registered to PAI Data Collector.\n\n'
                                f'Email: {email}\n'
                                f'Temporary password: {temp_password}\n\n'
                                f'Please log in with this temporary password.\n'
                                f'You will be prompted to set a new password on first login.\n'
                                f'(8+ characters, uppercase, number, and special character required)\n\n'
                                f'Thank you.'
                            ),
                            'Charset': 'UTF-8',
                        }
                    },
                },
            )
        except Exception as e:
            # Email failure is non-fatal in sandbox mode (unverified recipients)
            print(f'SES send error (non-fatal): {e}')

    return _resp(200, {'message': 'User created. Check your email for the temporary password.'})
