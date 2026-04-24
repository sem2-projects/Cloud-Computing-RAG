import json
import time
import urllib.request
from jose import jwk, jwt
from jose.utils import base64url_decode

REGION = 'us-east-1'
USER_POOL_ID = 'us-east-1_aFeEesShu'
APP_CLIENT_ID = '5q11a2si4enhuh2cgf0827r792'
KEYS_URL = f'https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json'


def get_public_keys():
    with urllib.request.urlopen(KEYS_URL) as response:
        return json.loads(response.read())['keys']


def lambda_handler(event, context):
    token = event.get('authorizationToken', '').replace('Bearer ', '')
    method_arn = event.get('methodArn')

    print(f"[DEBUG] Token prefix: {token[:30]}...")
    print(f"[DEBUG] Method ARN: {method_arn}")

    try:
        keys = get_public_keys()
        print(f"[DEBUG] Got {len(keys)} public keys from Cognito")

        headers = jwt.get_unverified_headers(token)
        kid = headers['kid']
        print(f"[DEBUG] Token kid: {kid}")

        key = next((k for k in keys if k['kid'] == kid), None)
        if not key:
            print(f"[DEBUG] DENY — no matching key found for kid: {kid}")
            return deny_policy('anonymous', method_arn)

        public_key = jwk.construct(key)
        message, encoded_sig = token.rsplit('.', 1)
        decoded_sig = base64url_decode(encoded_sig.encode())

        if not public_key.verify(message.encode(), decoded_sig):
            print(f"[DEBUG] DENY — signature verification failed")
            return deny_policy('anonymous', method_arn)

        claims = jwt.get_unverified_claims(token)
        print(f"[DEBUG] Claims aud: {claims.get('aud')}")
        print(f"[DEBUG] Claims exp: {claims.get('exp')} vs now: {int(time.time())}")
        print(f"[DEBUG] Expected client_id: {APP_CLIENT_ID}")

        if claims['exp'] < time.time():
            print(f"[DEBUG] DENY — token expired")
            return deny_policy('anonymous', method_arn)

        # Cognito ID tokens use 'aud', access tokens use 'client_id'
        token_aud = claims.get('aud') or claims.get('client_id', '')
        if token_aud != APP_CLIENT_ID:
            print(f"[DEBUG] DENY — client_id mismatch. Got: {token_aud}, Expected: {APP_CLIENT_ID}")
            return deny_policy('anonymous', method_arn)

        print(f"[DEBUG] ALLOW — user: {claims.get('email')}")
        return allow_policy(claims['sub'], method_arn, claims)

    except Exception as e:
        print(f"[ERROR] Authorization failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return deny_policy('anonymous', method_arn)


def allow_policy(principal_id, method_arn, claims):
    return {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{
                'Action': 'execute-api:Invoke',
                'Effect': 'Allow',
                'Resource': method_arn
            }]
        },
        'context': {
            'sub': claims.get('sub', ''),
            'email': claims.get('email', ''),
            'username': claims.get('cognito:username', '')
        }
    }


def deny_policy(principal_id, method_arn):
    return {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{
                'Action': 'execute-api:Invoke',
                'Effect': 'Deny',
                'Resource': method_arn
            }]
        }
    }
