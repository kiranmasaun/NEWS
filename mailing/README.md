# News Mailing Lambda — Production V11

Production version of the News mailing Lambda with cache table optimization and ISP routing via `category_id`.

**Function name:** `News_Mailing_Prod_V11`
**Stack name:** `news-mailing-prod-v11`
**Active brands:** TN (`topline_news`), NB (`news_beyond`), NC_yahoo (`news_command_yahoo`), NC_gmail (`news_command_gmail`)

---

## What Changed vs V10

Three changes applied to `src/NewsLogic.js`:

1. **Constructor** — `this.tempTable` resolves to a pre-built cache table (`questions_meta_cache_TN`, `questions_meta_cache_NC_yahoo`, or `questions_meta_cache_NC_gmail`) instead of building a temp table per invocation
2. **`createTempTable()`** — early returns `true` for cache projects; no JOIN runs per invocation
3. **`main()`** — skips `DROP TEMPORARY TABLE` for cache projects

ISP filtering uses `blogs.category_id` instead of `priority_rank_isp_flags`:
- NC_yahoo: `category_id = 2` (Crime only)
- NC_gmail: no filter (all NC articles)

Non-cache projects (TF, NB) are unaffected and still use the original temp table path.

---

## Prerequisites

- AWS SAM CLI installed
- AWS credentials configured (`us-west-2`)
- Cache tables must exist and be populated in prod RDS **before** invoking this Lambda:
  ```bash
  # 1. Run DDL against prod RDS (once)
  mysql -h write.engagemedia2.com -u sd.trivia.app.user -p NewsEngine < sql/create_cache_tables.sql

  # 2. Invoke cache refresh Lambda to populate tables
  sam remote invoke News_CacheTablesRefresh_Prod_V11 --region us-west-2
  ```

---

## First-Time Deployment

```bash
# 1. Navigate to this directory
cd News/Prod/v11/mailing

# 2. Install dependencies
cd src && npm install && cd ..

# 3. Build
sam build

# 4. Validate template
sam validate --template template.yml

# 5. Deploy
sam deploy --stack-name news-mailing-prod-v11 --resolve-s3 --capabilities CAPABILITY_NAMED_IAM

aws cloudformation delete-stack --stack-name news-mailing-prod-v11 --region us-west-2

sam deploy --guided \
  --stack-name news-mailing-prod-v11 \
  --region us-west-2 \
  --capabilities CAPABILITY_NAMED_IAM
```

When prompted, set the following parameters:

| Parameter   | Value                        |
|------------|------------------------------|
| DBHost     | sd-rds-01.c8lpklkvlcek.us-west-2.rds.amazonaws.com |
| DBName     | NewsEngine                   |
| DBPassword | (prod DB password)           |
| DBUser     | sd.trivia.app.user           |

---

## Subsequent Deployments

```bash
cd src && npm install && cd ..
sam build
sam deploy --stack-name news-mailing-prod-v11 \
  --resolve-s3 \
  --capabilities CAPABILITY_NAMED_IAM
```

---

## Test Flow

```bash
# Step 1 — Populate cache tables via the refresh Lambda
sam remote invoke News_CacheTablesRefresh_Prod_V11 --region us-west-2

# Step 2 — Invoke mailing Lambda with a test event
sam remote invoke News_Mailing_Prod_V11 \
  --event-file events/mailing-question-selection-NC.json \
  --region us-west-2

# Or test locally (requires Docker)
sam local invoke ContentMailingFunction \
  --event events/mailing-question-selection-NC.json \
  --region us-west-2

# Step 3 — Run all tests via test runner
./test-runner.sh local
./test-runner.sh remote
```

---

## Get Function URL

```bash
aws cloudformation describe-stacks \
  --stack-name news-mailing-prod-v11 \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" \
  --output text \
  --region us-west-2
```

Test via curl:

```bash
curl "YOUR_FUNCTION_URL?ip=1.2.3.4&template_id=148&email=test@example.com\
&response_format=rawHtml\
&json_config=%5B%7B%22qLimit%22%3A10%2C%22lookBackInterval%22%3A14%2C%22category%22%3A%22p2%22%2C%22priority%22%3A2%2C%22dataType%22%3A%22intro%22%7D%5D\
&dedup_service_project=news_command"
```

---

## View Logs

```bash
# Tail live logs
sam logs --stack-name news-mailing-prod-v11 --tail --region us-west-2

# Logs for last 30 minutes
sam logs --stack-name news-mailing-prod-v11 \
  --start-time "30 minutes ago" \
  --region us-west-2
```

---

## Rollback / Delete Stack

```bash
sam delete --stack-name news-mailing-prod-v11 --region us-west-2

# Or via CloudFormation
aws cloudformation delete-stack \
  --stack-name news-mailing-prod-v11 \
  --region us-west-2
```
