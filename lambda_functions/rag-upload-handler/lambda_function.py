import json
import boto3
import base64
import hashlib
import time
import io
from decimal import Decimal
from pypdf import PdfReader

s3 = boto3.client('s3', region_name='us-east-1')
dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')

BUCKET_NAME = 'rag-documents-dharmaswaroop'
TABLE_NAME = 'rag-embeddings'
EMBEDDING_MODEL = 'amazon.titan-embed-text-v1'
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


def lambda_handler(event, context):
    try:
        authorizer = event.get('requestContext', {}).get('authorizer', {})
        user_id = authorizer.get('sub', 'unknown')
        user_email = authorizer.get('email', 'unknown')

        print(f"[INFO] Upload request from {user_email}")

        body = json.loads(event.get('body') or '{}')
        filename = body.get('filename', '')
        content_base64 = body.get('content', '')
        content_type = body.get('contentType', 'application/octet-stream')

        if not filename or not content_base64:
            return error_response(400, 'filename and content are required')

        file_bytes = base64.b64decode(content_base64)

        document_id = hashlib.md5(
            f"{user_id}{filename}{time.time()}".encode()
        ).hexdigest()

        print(f"[INFO] Processing: {filename} | ID: {document_id}")

        s3_key = f"{user_id}/{document_id}/{filename}"
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=file_bytes,
            ContentType=content_type
        )

        text = extract_text(file_bytes, filename)
        if not text.strip():
            return error_response(400, 'Could not extract text from document')

        print(f"[INFO] Extracted {len(text)} characters")

        chunks = split_into_chunks(text, CHUNK_SIZE, CHUNK_OVERLAP)
        print(f"[INFO] Split into {len(chunks)} chunks")

        table = dynamodb.Table(TABLE_NAME)
        stored_chunks = 0

        for i, chunk in enumerate(chunks):
            embedding = generate_embedding(chunk)
            if embedding is None:
                continue

            # Convert floats to Decimal — DynamoDB requirement
            embedding_decimal = [Decimal(str(x)) for x in embedding]

            table.put_item(Item={
                'document_id': document_id,
                'chunk_id': f"chunk_{i:04d}",
                'user_id': user_id,
                'filename': filename,
                'text': chunk,
                'embedding': embedding_decimal,
                'chunk_index': i,
                'total_chunks': len(chunks),
                'uploaded_at': int(time.time()),
                's3_key': s3_key
            })
            stored_chunks += 1

        table.put_item(Item={
            'document_id': document_id,
            'chunk_id': 'METADATA',
            'user_id': user_id,
            'filename': filename,
            'total_chunks': len(chunks),
            'uploaded_at': int(time.time()),
            's3_key': s3_key,
            'file_size': len(file_bytes),
            'status': 'ready'
        })

        print(f"[INFO] Stored {stored_chunks} chunks")

        return success_response({
            'documentId': document_id,
            'filename': filename,
            'chunks': stored_chunks,
            'status': 'ready',
            'message': f'Successfully processed {filename} into {stored_chunks} searchable chunks'
        })

    except Exception as e:
        print(f"[ERROR] Upload failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return error_response(500, f'Upload failed: {str(e)}')


def extract_text(file_bytes, filename):
    filename_lower = filename.lower()
    try:
        if filename_lower.endswith('.pdf'):
            reader = PdfReader(io.BytesIO(file_bytes))
            text = ''
            for page in reader.pages:
                text += page.extract_text() + '\n'
            return text

        elif filename_lower.endswith('.docx'):
            import zipfile
            import xml.etree.ElementTree as ET
            text = ''
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
                with z.open('word/document.xml') as f:
                    tree = ET.parse(f)
                    root = tree.getroot()
                    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
                    for elem in root.iter(f'{ns}t'):
                        if elem.text:
                            text += elem.text + ' '
            return text

        else:
            return file_bytes.decode('utf-8', errors='ignore')

    except Exception as e:
        print(f"[ERROR] Text extraction failed: {str(e)}")
        return ''


def split_into_chunks(text, chunk_size, overlap):
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = ' '.join(words[start:end])
        chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def generate_embedding(text):
    try:
        response = bedrock.invoke_model(
            modelId=EMBEDDING_MODEL,
            contentType='application/json',
            accept='application/json',
            body=json.dumps({'inputText': text[:8000]})
        )
        result = json.loads(response['body'].read())
        return result['embedding']
    except Exception as e:
        print(f"[ERROR] Embedding failed: {str(e)}")
        return None


def success_response(data):
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization'
        },
        'body': json.dumps(data)
    }


def error_response(status_code, message):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization'
        },
        'body': json.dumps({'error': message})
    }
