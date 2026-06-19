# Local Testing Guide for News Mailing Lambda

This guide explains how to test the News Mailing Lambda function locally using AWS SAM.

## Prerequisites

1. **AWS SAM CLI** - [Installation Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
2. **Docker** - SAM requires Docker for local testing
3. **Node.js 22.x** - To match the Lambda runtime

## Quick Start

### Run All Tests
```bash
./test-runner.sh
```

### Run Specific Test
```bash
./test-runner.sh basic-test
```

### Available Tests

| Test Name | Description | Key Parameters |
|-----------|-------------|----------------|
| `basic-test` | Basic functionality with simple configuration | Standard email, single question config |
| `preferred-categories-test` | Tests preferred categories logic | Multiple configs with `p1` categories |
| `error-test` | Tests error handling and validation | Invalid email and project name |

## Manual Testing

### Basic SAM Commands

```bash
# Build the function
sam build

# validate the template
sam validate 

# Run specific test
sam local invoke ContentMailingFunction --event events/basic-test.json

# Run with debugging
sam local invoke ContentMailingFunction --event events/basic-test.json --debug
```

### Environment Variables

The function uses these environment variables (configured in template.yml):
- `db_host` - Database host
- `db_name` - Database name  
- `db_user` - Database user
- `db_password` - Database password

## Test Event Structure

Each test event in the `events/` directory follows the Lambda Function URL event format:

```json
{
  "version": "2.0",
  "routeKey": "$default",
  "rawPath": "/",
  "rawQueryString": "email=test@example.com&template_id=1&...",
  "queryStringParameters": {
    "email": "test@example.com",
    "template_id": "1",
    "dedup_service_project": "news_command"
  },
  "requestContext": { ... }
}
```

## Key Parameters

### Required Parameters
- `email` - User email (must be valid format)
- `template_id` - Template ID (integer)
- `dedup_service_project` - One of: `news_command`

### Configuration Options
- `json_config` - JSON array of question configurations (URL encoded)
- `response_format` - Response format: `combined`, `fullHtml`, `rawHtml`, `array`

### Question Configuration Structure
```json
[{
  "lookBackInterval": 1,
  "qLimit": 5,
  "dataType": "intro",
  "category": 1,
  "priority": 3
}]
```

### Category Types
- `1, 2, 3...` - Specific category IDs
- `p1, p2, p3...` - Preferred categories (position-based)

## Troubleshooting

### Common Issues

1. **Docker not running**
   ```
   Error: Could not find Docker
   ```
   Solution: Start Docker Desktop

2. **Build failures**
   ```
   Error: Build failed
   ```
   Solution: Check that all dependencies are properly listed in package.json

3. **Database connection errors**
   ```
   Error: connect ECONNREFUSED
   ```
   Solution: Ensure database credentials are correct and database is accessible

4. **Invalid JSON config**
   ```
   Error parsing json_config
   ```
   Solution: Ensure JSON is properly URL encoded in test events

### Debug Mode

Run with additional debugging:
```bash
sam local invoke ContentMailingFunction --event events/basic-test.json --debug --log-file sam-debug.log
```

### Custom Test Events

Create new test events by copying an existing event file and modifying the parameters:

```bash
cp events/basic-test.json events/my-custom-test.json
# Edit my-custom-test.json
./test-runner.sh my-custom-test
```

## Expected Response Format

Successful responses:
```json
{
  "statusCode": 200,
  "headers": {"Content-Type": "application/json"},
  "body": "{\"success\":true,\"payload\":\"<html>...</html>\"}"
}
```

Error responses:
```json
{
  "statusCode": 400,
  "headers": {"Content-Type": "application/json"},
  "body": "{\"success\":false,\"message\":\"Error description\"}"
}
```