# Deployment Notes

## AWS Resources Created

| Resource | Name | Purpose |
|---|---|---|
| Cognito User Pool | us-east-1_aFeEesShu | User authentication |
| API Gateway | rag-api | REST endpoints |
| Lambda | rag-upload-handler | Document processing |
| Lambda | rag-query-handler | RAG query + AI |
| Lambda | rag-list-handler | Document listing |
| Lambda | rag-authorizer | JWT validation |
| DynamoDB | rag-embeddings | Vector storage |
| S3 | rag-documents-dharmaswaroop | Document files |
| S3 | rag-frontend-dharmaswaroop | React frontend |
| CloudFront | d2dqj0m7kr4lcj.cloudfront.net | HTTPS CDN |
| CloudWatch | RAG-System-Dashboard | Monitoring |

## Challenges Faced

1. **Cross-account Cognito**: Cognito pool was in a different
   AWS account. Solved by building a Lambda authorizer that validates JWT
   tokens using Cognito's public JWKS endpoint no cross-account access needed.

2. **Mac vs Lambda architecture**: pip installed ARM binaries on Apple
   Silicon Mac that crashed on Lambda's x86 Linux. Solved by using
   `--platform manylinux2014_x86_64` flag during pip install.

3. **DynamoDB Decimal types**: Python floats from Bedrock embeddings
   can't be stored directly in DynamoDB. Solved by converting all
   embedding values to Decimal type before storage.

4. **CORS configuration**: Browser blocked API requests due to
   cross-origin policy. Solved by configuring OPTIONS methods on
   API Gateway with proper Access-Control headers.

## Deployment Order

1. Create Cognito user pool
2. Create DynamoDB table and S3 buckets
3. Create IAM roles with Bedrock/DynamoDB/S3 permissions
4. Deploy Lambda functions with dependencies
5. Create API Gateway with Lambda authorizer
6. Configure CORS on all endpoints
7. Deploy frontend to S3
8. Set up CloudFront distribution
9. Configure CloudWatch alarms and dashboard
