# DedupService Lambda — Production V3

SAM-managed production DedupService with DynamoDB cost optimizations applied.

**Function name:** `DedupService_Prod_V3`
**Stack name:** `dedup-service-prod-v3`
**Source file:** `index.js` (copied from `dedup-api-v2/dedup-prod2-no-legacy-opt.js`)
**No VPC** — DynamoDB does not require VPC access

---

## What Changed vs V2

Two DynamoDB cost optimizations applied on top of `dedup-prod2-no-legacy-opt.js`:

**Option 1 — Eventually Consistent Reads (`ConsistentRead: false`)**
- `getBatchItemsFromDDB()` now passes `ConsistentRead: false` in every `BatchGetItem` call
- Halves read RCU cost on all `get` endpoint calls
- Acceptable for dedup: a 1–2 second eventual consistency window does not affect duplicate prevention

**Option 3 — Active-Dates Summary Item**
- New `getActiveDates()` function reads a pre-built `ACTIVE_DATES` summary item instead of batch-fetching all 90 daily keys
- New `updateActiveDatesSummary()` function updates the summary item on every `log` call
- Reduces `BatchGetItem` from up to 90 keys per request down to 1–2 keys for most users
- Summary item key: `{ pk: "ACTIVE_DATES", sk: "{email}" }`

All original dedup functionality is unchanged: `log` / `get` endpoints, `tableDef` per-project table routing, `bold_fact` headline_index tracking, `o_multiDedupProjectList`, TTL, hit counter.

---

## Prerequisites

- AWS SAM CLI installed
- AWS credentials configured (`us-west-2`)
- **Before going live**: add a skip guard in `dedup-utility/main.py` to ignore `ACTIVE_DATES` summary items during table scans/deletes (these items have `pk = "ACTIVE_DATES"` and must not be treated as user records)

---

## First-Time Deployment

```bash
# 1. Navigate to this directory
cd DedupService/dedup-api-v3

# 2. Install dependencies
npm install

# 3. Build
sam build

# 4. Validate template
sam validate --template template.yml

# 5. Deploy (guided — first time only, saves samconfig.toml)
sam deploy --stack-name dedup-service-prod-v3  --resolve-s3 --capabilities CAPABILITY_NAMED_IAM

aws cloudformation delete-stack --stack-name  dedup-service-prod-v3 --region us-west-2 

sam deploy --guided \
  --stack-name dedup-service-prod-v3 \
  --region us-west-2 \
  --capabilities CAPABILITY_NAMED_IAM
```

No DB parameters — DedupService connects only to DynamoDB.

---

## Subsequent Deployments

```bash
npm install
sam build
sam deploy --stack-name dedup-service-prod-v3 \
  --resolve-s3 \
  --capabilities CAPABILITY_NAMED_IAM
```

---

## Get Function URL

```bash
aws cloudformation describe-stacks \
  --stack-name dedup-service-prod-v3 \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" \
  --output text \
  --region us-west-2
```

---

## Wire Up — Update All Project index.js Files

After deploy, update the `dedupApiV2` constant in every project that calls V2 today:

| Project | File |
|---------|------|
| News | `RegulatedEnv/News/Prod/v11/mailing/src/index.js` |
| Jokes | `RegulatedEnv/Jokes/Prod/v10/mailing/src/index.js` |
| Word | `RegulatedEnv/Word/Prod/v10/mailing/src/index.js` |
| Cms | `RegulatedEnv/Cms/Prod/v10/web/src/index.js` |

> **Trivia uses a separate dedup URL** — confirm scope before updating Trivia.

Replace the old URL in each file:

```js
const dedupApiV2 = 'YOUR_V3_FUNCTION_URL';
```

---

## Manual Invocation (Test)

```bash
# Test the get endpoint
sam remote invoke DedupService_Prod_V3 \
  --region us-west-2 \
  --event '{"queryStringParameters":{"useCase":"get","g_email":"test@example.com","g_dedupedPeriod":"14","g_dedupedProject":"news_command"}}'
```

---

## View Logs

```bash
# Tail live logs
sam logs --stack-name dedup-service-prod-v3 --tail --region us-west-2

# Logs for last 30 minutes
sam logs --stack-name dedup-service-prod-v3 \
  --start-time "30 minutes ago" \
  --region us-west-2
```

---

## Rollback / Delete Stack

```bash
sam delete --stack-name dedup-service-prod-v3 --region us-west-2

# Or via CloudFormation
aws cloudformation delete-stack \
  --stack-name dedup-service-prod-v3 \
  --region us-west-2
```

> DynamoDB tables are NOT deleted by stack deletion — existing user activity data is preserved.

---

## Rollback to V2

If V3 causes issues, revert `dedupApiV2` constants in all project `index.js` files back to the V2 Function URL. No DynamoDB changes needed — V3 writes are backward-compatible with V2 reads.
