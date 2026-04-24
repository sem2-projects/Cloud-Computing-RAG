import json
import boto3
import math
from decimal import Decimal

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')

TABLE_NAME = 'rag-embeddings'
EMBEDDING_MODEL = 'amazon.titan-embed-text-v1'
GENERATION_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
TOP_K = 5


def lambda_handler(event, context):
    try:
        authorizer = event.get('requestContext', {}).get('authorizer', {})
        user_id = authorizer.get('sub', 'unknown')
        user_email = authorizer.get('email', 'unknown')

        body = json.loads(event.get('body') or '{}')
        question = body.get('query', '') or body.get('question', '')

        if not question.strip():
            return error_response(400, 'question is required')

        print(f"[INFO] Query from {user_email}: {question}")

        # Step 1: Convert question to vector
        question_embedding = generate_embedding(question)
        if question_embedding is None:
            return error_response(500, 'Failed to generate question embedding')

        # Step 2: Get all chunks for this user
        table = dynamodb.Table(TABLE_NAME)
        response = table.scan(
            FilterExpression='user_id = :uid AND chunk_id <> :meta',
            ExpressionAttributeValues={
                ':uid': user_id,
                ':meta': 'METADATA'
            }
        )
        chunks = response.get('Items', [])

        while 'LastEvaluatedKey' in response:
            response = table.scan(
                FilterExpression='user_id = :uid AND chunk_id <> :meta',
                ExpressionAttributeValues={
                    ':uid': user_id,
                    ':meta': 'METADATA'
                },
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            chunks.extend(response.get('Items', []))

        print(f"[INFO] Found {len(chunks)} chunks")

        if not chunks:
            return success_response({
                'answer': 'You have no documents uploaded yet. Please upload a document first.',
                'sources': []
            })

        # Step 3: Score each chunk against the question
        scored_chunks = []
        for chunk in chunks:
            if 'embedding' not in chunk:
                continue
            # Convert Decimal back to float for math
            chunk_embedding = [float(x) for x in chunk['embedding']]
            score = cosine_similarity(question_embedding, chunk_embedding)
            scored_chunks.append({
                'text': chunk['text'],
                'filename': chunk.get('filename', 'unknown'),
                'document_id': chunk.get('document_id', ''),
                'score': score
            })

        scored_chunks.sort(key=lambda x: x['score'], reverse=True)
        top_chunks = scored_chunks[:TOP_K]

        print(f"[INFO] Top score: {top_chunks[0]['score']:.4f}" if top_chunks else "[INFO] No chunks")

        # Step 4: Build prompt with context
        context_text = "\n\n".join([
            f"[Source: {c['filename']}, Relevance: {c['score']:.2%}]\n{c['text']}"
            for c in top_chunks
        ])

        prompt = f"""You are a helpful assistant that answers questions based on provided documents.

Here are the relevant excerpts from the user's documents:

{context_text}

Based ONLY on the above document excerpts, answer this question:
{question}

Rules:
- Only use information from the provided excerpts
- If the answer is not in the excerpts, say "I couldn't find information about this in your documents"
- Cite which document your answer comes from
- Be concise and clear"""

        # Step 5: Call Claude
        answer = call_claude(prompt)
        if answer is None:
            return error_response(500, 'Failed to generate answer')

        # Step 6: Return answer and sources
        sources = [
            {
                'document': c['filename'],
                'text': c['text'][:200] + '...' if len(c['text']) > 200 else c['text'],
                'score': float(c['score'])
            }
            for c in top_chunks
            if c['score'] > 0.3
        ]

        return success_response({
            'answer': answer,
            'sources': sources,
            'chunks_searched': len(chunks)
        })

    except Exception as e:
        print(f"[ERROR] Query failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return error_response(500, f'Query failed: {str(e)}')


def cosine_similarity(vec1, vec2):
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    magnitude1 = math.sqrt(sum(a * a for a in vec1))
    magnitude2 = math.sqrt(sum(b * b for b in vec2))
    if magnitude1 == 0 or magnitude2 == 0:
        return 0.0
    return dot_product / (magnitude1 * magnitude2)


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


def call_claude(prompt):
    try:
        response = bedrock.invoke_model(
            modelId=GENERATION_MODEL,
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 1000,
                'messages': [{'role': 'user', 'content': prompt}]
            })
        )
        result = json.loads(response['body'].read())
        return result['content'][0]['text']
    except Exception as e:
        print(f"[ERROR] Claude failed: {str(e)}")
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
