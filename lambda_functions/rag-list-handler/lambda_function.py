import json
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
TABLE_NAME = 'rag-embeddings'


class DecimalEncoder(json.JSONEncoder):
    """Converts DynamoDB Decimal types to int or float for JSON."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


def lambda_handler(event, context):
    try:
        authorizer = event.get('requestContext', {}).get('authorizer', {})
        user_id = authorizer.get('sub', 'unknown')

        table = dynamodb.Table(TABLE_NAME)
        response = table.scan(
            FilterExpression='user_id = :uid AND chunk_id = :meta',
            ExpressionAttributeValues={
                ':uid': user_id,
                ':meta': 'METADATA'
            }
        )

        documents = []
        for item in response.get('Items', []):
            documents.append({
                'id': item['document_id'],
                'filename': item.get('filename', 'unknown'),
                'uploadedAt': int(item.get('uploaded_at', 0)),
                'totalChunks': int(item.get('total_chunks', 0)),
                'status': item.get('status', 'ready'),
                'fileSize': int(item.get('file_size', 0))
            })

        documents.sort(key=lambda x: x['uploadedAt'], reverse=True)

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization'
            },
            'body': json.dumps({'documents': documents}, cls=DecimalEncoder)
        }

    except Exception as e:
        print(f"[ERROR] List failed: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization'
            },
            'body': json.dumps({'error': str(e)})
        }
