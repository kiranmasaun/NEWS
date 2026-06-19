# News Cache Tables Refresh Lambda — Production V11

Production cache refresh Lambda that pre-materializes mailing query cache tables daily via RENAME swap.

**Function name:** `News_CacheTablesRefresh_Prod_V11`
**Stack name:** `news-cache-tables-refresh-prod-v11`
**Schedule:** Daily at 3am PST (`cron(0 11 * * ? *)` UTC) — 1 hour before send window
**Brands refreshed:** TN (`articles_meta_cache_TN`), NB (`articles_meta_cache_NB`), NC_yahoo (`articles_meta_cache_NC_yahoo`), NC_gmail (`articles_meta_cache_NC_gmail`)

---

## How It Works

1. For each brand (TN, NC_yahoo, NC_gmail), runs the JOIN against the **prod RDS write endpoint**
2. Inserts results into a `_new` table
3. Atomically swaps via `RENAME TABLE live → old, new → live`
4. Drops the old table
5. Prod mailing Lambda (`News_Mailing_Prod_V11`) reads from the live cache table

ISP filtering uses `blogs.category_id` instead of `priority_rank_isp_flags`:
- NC_yahoo: `category_id = 2` (Crime only)
- NC_gmail: no filter (all NC articles)

---

## Prerequisites

- AWS SAM CLI installed
- AWS credentials configured (`us-west-2`)
- Cache tables created in prod RDS — run this once before first deploy:
  ```bash
  # From News/Prod/v11/mailing/sql/
  mysql -h sd-rds-01.c8lpklkvlcek.us-west-2.rds.amazonaws.com -u sd.trivia.app.user -p NewsEngine < create_cache_tables.sql
  ```

---

## First-Time Deployment

```bash
# 1. Navigate to this directory
cd News/Prod/v11/newsCacheTablesRefresh

# 2. Install dependencies
cd src && npm install && cd ..

# 3. Build
sam build

# 4. Validate template
sam validate --template template.yml

# 5. Deploy
sam deploy --stack-name news-cache-tables-refresh-prod-v11 --resolve-s3 --capabilities CAPABILITY_NAMED_IAM

aws cloudformation delete-stack --stack-name news-cache-tables-refresh-prod-v11 --region us-west-2

sam deploy --guided \
  --stack-name news-cache-tables-refresh-prod-v11 \
  --region us-west-2 \
  --capabilities CAPABILITY_NAMED_IAM
```

When prompted, set the following parameters:

| Parameter        | Value                         |
|-----------------|-------------------------------|
| DBHost          | sd-rds-01.c8lpklkvlcek.us-west-2.rds.amazonaws.com |
| DBName          | NewsEngine                    |
| DBPassword      | (prod DB password)            |
| DBUser          | sd.trivia.app.user            |
| ScheduleUtcHour | 11  (3am PST standard time)   |

> EventBridge schedule is created automatically by SAM on deploy — no manual Console setup needed for prod.

---

## Subsequent Deployments

```bash
cd src && npm install && cd ..
sam build
sam deploy --stack-name news-cache-tables-refresh-prod-v11 \
  --resolve-s3 \
  --capabilities CAPABILITY_NAMED_IAM
```

---

## Test Flow

Run these steps in order every time you test:

```bash
# Step 1 — Trigger the cache refresh Lambda manually
sam remote invoke News_CacheTablesRefresh_Prod_V11 --region us-west-2

# Step 2 — Confirm cache tables are populated (run against prod RDS)
# SELECT 'articles_meta_cache_TN',       COUNT(*) FROM NewsEngine.articles_meta_cache_TN
# UNION ALL
# SELECT 'articles_meta_cache_NB',       COUNT(*) FROM NewsEngine.articles_meta_cache_NB
# UNION ALL
# SELECT 'articles_meta_cache_NC_yahoo', COUNT(*) FROM NewsEngine.articles_meta_cache_NC_yahoo
# UNION ALL
# SELECT 'articles_meta_cache_NC_gmail', COUNT(*) FROM NewsEngine.articles_meta_cache_NC_gmail;

# Step 3 — Invoke the prod mailing Lambda
sam remote invoke News_Mailing_Prod_V11 \
  --event-file ../mailing/events/mailing-question-selection-NC.json \
  --region us-west-2

# Step 4 — Confirm NO temp table creation in RDS slow query log
# (should see only SELECT from cache tables, no CREATE TEMPORARY TABLE)
```

---

## Manual Invocation

```bash
# Direct function invoke
sam remote invoke News_CacheTablesRefresh_Prod_V11 \
  --region us-west-2

# Via stack name
sam remote invoke --stack-name news-cache-tables-refresh-prod-v11 \
  NewsCacheTablesRefreshFunction \
  --region us-west-2
```

---

## View Logs

```bash
# Tail live logs
sam logs --stack-name news-cache-tables-refresh-prod-v11 --tail --region us-west-2

# Logs for last 30 minutes
sam logs --stack-name news-cache-tables-refresh-prod-v11 \
  --start-time "30 minutes ago" \
  --region us-west-2
```

---

## Enable / Disable Schedule

```bash
# Disable schedule (e.g. during maintenance)
aws events disable-rule \
  --name NewsCacheRefreshProdV11Schedule \
  --region us-west-2

# Re-enable
aws events enable-rule \
  --name NewsCacheRefreshProdV11Schedule \
  --region us-west-2
```

---

## Rollback / Delete Stack

```bash
sam delete --stack-name news-cache-tables-refresh-prod-v11 --region us-west-2

# Or via CloudFormation
aws cloudformation delete-stack \
  --stack-name news-cache-tables-refresh-prod-v11 \
  --region us-west-2
```

> Cache tables in prod RDS are NOT dropped by stack deletion.
