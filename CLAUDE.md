# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a serverless monorepo containing AWS Lambda functions for multiple content-delivery projects. Each project serves content (trivia questions, jokes, news articles, word games) via **web** (HTTP API) and **mailing** (email generation) Lambda functions, deployed with AWS SAM. A shared **DedupService** prevents duplicate content delivery across all projects.

---

## Repository Structure

All active Lambda functions live under:

```
Lambda/Lambda_Regulated/
├── RegulatedEnv/    # All content-delivery Lambda projects
│   ├── Cms/
│   ├── Jokes/
│   ├── News/
│   ├── Trivia/
│   └── Word/
└── DedupService/    # Shared deduplication service (used by all projects)
    ├── dedup-api-v1/
    ├── dedup-api-v2/
    └── dedup-api-v3/
```

> The `Deprecated/` and `UnregulatedEnv/` folders are not in active use and should be ignored.

---

## RegulatedEnv Projects

Each project follows the path pattern:

```
RegulatedEnv/{Project}/{Env}/v{N}/{web|mailing|newsCacheTablesRefresh}/
```

Where `Env` is `Prod` or `Staging`. **Trivia**, **Word**, and **News** have Staging environments. Cms and Jokes are Prod only. Most projects are at `v10`; News mailing and newsCacheTablesRefresh are at `v11` in Prod.

Within each function directory:
- `template.yml` - SAM/CloudFormation template (IAM role, Lambda config, VPC, Function URL)
- `src/index.js` - Lambda handler entry point
- `src/{Project}Logic*.js` - Business logic class (e.g., `TriviaLogicPhase6Web.js`, `WordTriviaLogicPhase8.js`, `JokesWebLogic.js`, `NewsLogic.js`)
- `src/db.js` - MySQL connection pool module
- `src/package.json` - Dependencies
- `events/*.json` - Test event files (Lambda Function URL v2.0 format)
- `test-runner.sh` - Test runner script

---

### Cms

**Path:** `RegulatedEnv/Cms/Prod/v10/web/`

**Environments:** Prod only
**Function types:** Web only (no mailing)
**Sub-projects:** Handles user signup across all sub-projects from every project domain

**Purpose:** Central CMS API for user registration. Unlike all other projects, it requires API key validation via the `x-api-key` header (keys stored in `a_keys.production.json`). It handles `userSignUp` requests from every project domain in one place.

**Lambda function name:** `Cms_Web_Prod_V10`

**Stack name:** `cms-web-prod-v10`

---

### Jokes

**Path:** `RegulatedEnv/Jokes/Prod/v10/{web|mailing}/`

**Environments:** Prod only
**Function types:** Web + Mailing
**Sub-projects:** `the_humor`, `witty_cats`

**Purpose:** Delivers humor content (jokes and blog posts) to users. The web function handles gameplay and user interactions; the mailing function generates email HTML with joke content using `node-html-parser`.

**Lambda function names:**
- `Jokes_Web_Prod_V10`
- `Jokes_Mailing_Prod_V10`

**Stack names:**
- `jokes-web-prod-v10`
- `jokes-mailing-prod-v10`

---

### News

**Paths:**
- `RegulatedEnv/News/Prod/v10/{web|mailing|newsCacheTablesRefresh}/` — v10 Prod
- `RegulatedEnv/News/Prod/v11/{mailing|newsCacheTablesRefresh}/` — **v11 Prod (active)**
- `RegulatedEnv/News/Staging/v10/{mailing|newsCacheTablesRefresh}/` — v10 Staging

**Environments:** Prod (v10 + v11) + Staging (v10)
**Function types:** Web + Mailing + newsCacheTablesRefresh
**Note:** Web exists in v10 Prod only. Staging has `mailing` and `newsCacheTablesRefresh` only. v11 has `mailing` and `newsCacheTablesRefresh` only (no web).
**Sub-projects:** `bold_fact`, `news_command`, `topline_news`, `news_beyond`
**SQL scripts:** `News/Staging/v10/mailing/sql/create_cache_tables.sql` — DDL for ISP-based cache tables in staging. Run once before deploying. `News/Prod/v11/mailing/sql/create_cache_tables.sql` — DDL for all 4 v11 prod cache tables (TN, NB, NC_yahoo, NC_gmail).

**Purpose:** Delivers news articles to users. The web function serves article content with category filtering; the mailing function generates email HTML from article selections. The `bold_fact` sub-project has special handling in the dedup service for tracking `headline_index` variants. The `newsCacheTablesRefresh` function pre-materializes mailing query cache tables on a daily schedule via RENAME swap.

**v11 differences from v10:**
- Added `articles_meta_cache_NB` cache table (NB = news_beyond brand) — v10 only had TN + NC_yahoo + NC_gmail
- `CATEGORY_COLOR_MAP` for NB brand category colors (`{article_category_color}` macro)
- Featured content template split using `node-html-parser` (single vs dual `<question>` template elements)
- Headline rotation (`getNextHeadlineToServe`) for the first article
- `priority_rank_created_at` column in all 4 cache tables (populated from `priority_rank.created_at`)

**Lambda function names (v10):**
- `News_Web_Prod_V10`
- `News_Mailing_Prod_V10`
- `News_Mailing_Staging_V10`
- `News_CacheTablesRefresh_Prod_V10`
- `News_CacheTablesRefresh_Staging_V10`

**Lambda function names (v11 — active Prod mailing):**
- `News_Mailing_Prod_V11`
- `News_CacheTablesRefresh_Prod_V11`

**Stack names (v10):**
- `news-web-prod-v10`
- `news-mailing-prod-v10`
- `news-mailing-staging-v10`
- `news-cache-tables-refresh-prod-v10`
- `news-cache-tables-refresh-staging-v10`

**Stack names (v11):**
- `news-mailing-prod-v11`
- `news-cache-tables-refresh-prod-v11`

---

### Trivia

**Path:** `RegulatedEnv/Trivia/{Env}/v10/{web|mailing}/`

**Environments:** Prod + Staging
**Function types:** Web + Mailing
**Sub-projects:** `eightys_trivia`, `trivia_quest`, `golden_trivia`, `trivia_online`

**Purpose:** Core trivia game platform. Web function handles question delivery, user scoring, leaderboards, and user registration. Mailing function generates trivia question email content. Trivia uses a **different dedup service URL** from other projects.

**Lambda function names:**
- `Trivia_Web_Prod_V10`
- `Trivia_Mailing_Prod_V10`
- `Trivia_Web_Staging_V10`
- `Trivia_Mailing_Staging_V10`

**Stack names:**
- `trivia-web-prod-v10`
- `trivia-mailing-prod-v10`
- `trivia-web-staging-v10`
- `trivia-mailing-staging-v10`

---

### Word

**Path:** `RegulatedEnv/Word/{Env}/v10/{web|mailing}/`

**Environments:** Prod + Staging
**Function types:** Web + Mailing
**Sub-projects:** `the_explain`, `lettermuse`, `word_fab`, `word_trivia`, `school_of_word`, `word_coaster`, `word_hopper`
**Additional:** `Word/Docs/` folder contains non-Lambda documentation

**Purpose:** Word trivia/puzzle game platform. Serves word definitions, spelling challenges, and vocabulary games. Web function handles question delivery and user interactions; mailing function generates word-game email content.

**Lambda function names:**
- `Word_Web_Prod_V10`
- `Word_Mailing_Prod_V10`
- `Word_Web_Staging_V10`
- `Word_Mailing_Staging_V10`

**Stack names:**
- `word-web-prod-v10`
- `word-mailing-prod-v10`
- `word-web-staging-v10`
- `word-mailing-staging-v10`

---

## DedupService

**Path:** `Lambda/Lambda_Regulated/DedupService/`

The DedupService is a shared Lambda used by all RegulatedEnv projects to prevent showing duplicate content to users. Every web and mailing function calls it before selecting content. There are three versions: v1 (legacy), v2 (current production), and v3 (ready to deploy — two DynamoDB cost optimizations on top of v2).

Both versions expose the same two endpoints via query parameter `useCase`:

| `useCase` | Direction | Description |
|-----------|-----------|-------------|
| `log`     | Write     | Records which content IDs were served to a user |
| `get`     | Read      | Returns the set of content IDs already seen by a user (forbidden IDs) |

Content functions call `DedupServiceGet` before selection and `DedupServiceLog` after delivery. The `dedup_service_project` query param identifies which project's rules to apply.

---

### dedup-api-v1

**Path:** `DedupService/dedup-api-v1/`

**Files:**
- `index-prod.js` - Production Lambda handler
- `index-qa.js` - QA Lambda handler
- `dedup-prod.js` - Production business logic
- `readme.md` - Documentation

**How it works:**

- **Single-table design**: All projects share two DynamoDB tables — `engagement_user_activity` and `engagement_request_log`
- **Hardcoded project whitelist**: The handler validates `dedup_service_project` against a static list of 21 allowed project names
- **`log` endpoint**: Stores user activity by email + date composite key in DynamoDB; merges new question IDs into the existing set for that date using `updateItemInDDB()`
- **`get` endpoint**: Fetches all activity records for a user across the requested period using `getBatchItemsFromDDB()`, then returns a map of `{ project: [id, id, ...] }`
- No TTL (records do not auto-expire)
- No multi-table or cross-project aggregation

**Limitations:** Scaling a single DynamoDB table across all projects reduces isolation. No automatic data expiration.

---

### dedup-api-v2

**Path:** `DedupService/dedup-api-v2/`

**Files:**
- `dedup-prod2-no-legacy-opt.js` - **Active production file** (optimised, no legacy code)
- `dedup-prod2-no-legacy.js` - Intermediate version (no legacy, pre-optimisation)
- `dedup-prod2-with-legacy-bk.js` - Backup with legacy code preserved
- `dedup-qa2.js` - QA handler + business logic (combined)
- `dedup-utility/main.py` - Python DynamoDB table management utility
- `dedup-utility/getter.py` - Python data export utility
- `readme.md` - Documentation

**How it works:**

V2 is a significant architectural upgrade over V1. Core changes:

**Multi-table design (per-project isolation):**
Each sub-project gets its own pair of DynamoDB tables defined in the `tableDef` map:
```javascript
'eightys_trivia': {
  activity_table: 'engagement_user_activity_eightys_trivia',
  log_table:      'engagement_request_log_eightys_trivia',
}
```
A `setTableVars()` function selects the correct table pair per request. The project whitelist is auto-generated from `tableDef` keys (no hardcoded list).

**`log` endpoint enhancements:**
- Same write pattern as v1 but also sets a `ttl_value` (90 days from epoch) and increments a `hit_counter` on each update
- Stores a `normalised_activity_date` alongside the raw timestamp
- Handles `bold_fact` project's special `headline_index` tracking for article variant deduplication

**`get` endpoint enhancements:**
- Supports `o_multiDedupProjectList` parameter: a single request can aggregate dedup data from multiple project tables concurrently using `Promise.all()`
- Prevents duplicate table queries when multiple sub-projects map to the same table
- Always includes the legacy shared table in multi-project queries for backward compatibility
- Supports `responseGrouping=byDate` to return results grouped by date instead of by project:
  ```json
  { "2025-07-21": { "eightys_trivia": ["q1"], "word_trivia": ["q4"] } }
  ```

**Other V2 improvements:**
- **TTL**: Records auto-expire after 90 days via DynamoDB TTL; no manual cleanup needed
- **Hit counter**: Tracks how often a user's record is queried (for monitoring)
- **Timestamp normalization**: `correctLambdaEventTimestamp()` converts Apache log format timestamps to ISO format
- **`_web` suffix stripping**: Automatically removes `_web` suffix from project names for flexibility
- **Improved error messages**: Parameter-specific validation errors instead of generic messages

**Python Utilities (V2 only):**

`dedup-utility/main.py` — `DynamoDBTableManager`:
- Discovers tables by prefix pattern
- Counts and deletes records with batch processing
- Scans/queries with filtering
- Clones tables with data copy
- Enables/disables TTL
- Used for operational table management and migrations

`dedup-utility/getter.py` — `DynamoDBDataGetter`:
- Exports project-specific data (e.g., `word_memo`) to CSV
- Filters by date range and query string patterns
- Handles DynamoDB pagination with rate limiting
- Used for data analysis and debugging

**V1 vs V2 Comparison:**

| Feature | V1 | V2 |
|---------|----|----|
| Table design | Single shared table | Per-project tables |
| Project whitelist | Hardcoded array | Auto-generated from tableDef |
| Multi-project queries | No | Yes (concurrent via Promise.all) |
| TTL / auto-expiry | No | Yes (90 days) |
| Hit counter tracking | No | Yes |
| Date-grouped responses | No | Yes |
| Timestamp normalization | No | Yes |
| Python utilities | No | Yes |

---

### dedup-api-v3

**Path:** `DedupService/dedup-api-v3/`

**Files:**
- `src/index.js` - Lambda handler + business logic (based on `dedup-prod2-no-legacy-opt.js`)
- `template.yml` - SAM template
- `README.md` - Deployment and wire-up instructions

**Status:** Built and ready to deploy. Not yet wired up to production callers.

**How it works:**

V3 is `dedup-prod2-no-legacy-opt.js` (V2 active file) plus two DynamoDB cost optimizations:

**Optimization 1 — Eventually Consistent Reads:**
- `ConsistentRead: false` passed in every `BatchGetItem` call inside `getBatchItemsFromDDB()`
- Halves read RCU cost on all `get` endpoint calls
- Safe for dedup: a 1–2 second eventual consistency window does not affect duplicate prevention

**Optimization 2 — Active-Dates Summary Item:**
- New `getActiveDates()` function reads a pre-built `ACTIVE_DATES` summary item per user instead of batch-fetching all 90 daily activity keys
- New `updateActiveDatesSummary()` function updates the summary item on every `log` call
- Reduces `BatchGetItem` keys from up to 90 per request down to 1–2 for most users
- Summary item key: `{ pk: "ACTIVE_DATES", sk: "{email}" }`

**4 Code changes vs V2 (`dedup-prod2-no-legacy-opt.js`):**
1. Removed `legacy` entry from `tableDef` — no more references to shared `engagement_user_activity` / `engagement_request_log` tables
2. Removed forced legacy table inclusion in multi-project queries
3. `setTableVars()` returns `false` for unknown projects (instead of silently falling back to legacy)
4. Whitelist validation added in `log` path (was only in `get` path in V2)

**`tableDef` projects (20 total):** `eightys_trivia`, `word_trivia`, `school_of_word`, `trivia_quest`, `lettermuse`, `the_explain`, `word_hopper`, `trivia_loop`, `golden_trivia`, `news_command`, `truth_facts`, `word_bar`, `topline_news`, `word_luck`, `doctor_humor`, `word_memo`, `funny_geeks`, `news_beyond`, `daily_wordplay`, `all_news`

**Function name:** `DedupService_Prod_V3`
**Stack name:** `dedup-service-prod-v3`

**Wire-up (after deploy):** Update `dedupApiV2` constant in these files to the V3 Function URL:
- `RegulatedEnv/News/Prod/v11/mailing/src/index.js`
- `RegulatedEnv/Jokes/Prod/v10/mailing/src/index.js`
- `RegulatedEnv/Word/Prod/v10/mailing/src/index.js`
- `RegulatedEnv/Cms/Prod/v10/web/src/index.js`

> **Trivia uses a separate dedup URL** — confirm scope separately before updating Trivia.

**Pre-launch requirement:** Add a skip guard in `dedup-utility/main.py` (V2 Python utility) to ignore `ACTIVE_DATES` summary items during table scans/deletes. These items have `pk = "ACTIVE_DATES"` and must not be treated as user records.

**Rollback:** Revert `dedupApiV2` constants in all project `index.js` files back to the V2 Function URL. No DynamoDB changes needed — V3 writes are backward-compatible with V2 reads.

---

## Build and Deploy Commands

All commands must be run from a specific function directory (e.g., `RegulatedEnv/Trivia/Prod/v10/web/`).

```bash
# Install dependencies
cd src && npm install && cd ..

# Build
sam build

# Validate template
sam validate --template template.yml

# Deploy (first time, guided)
sam deploy --guided

# Deploy (with saved config)
sam deploy --stack-name {project}-{type}-{env}-v10 --resolve-s3 --capabilities CAPABILITY_NAMED_IAM

# View logs
sam logs --stack-name {project}-{type}-{env}-v10 --tail

# Delete stack
sam delete --stack-name {project}-{type}-{env}-v10
```

Stack naming: `{project}-{type}-{env}-v{N}` (e.g., `trivia-web-prod-v10`, `jokes-mailing-prod-v10`, `news-mailing-prod-v11`).

---

## Testing

```bash
# Run all tests locally (from a function directory)
./test-runner.sh

# Run all tests locally (explicit)
./test-runner.sh local

# Run a specific test locally
./test-runner.sh local web-question-selection-eightys

# Run tests against deployed function
./test-runner.sh remote

# Run specific test against deployed function
./test-runner.sh remote web-question-selection-eightys

# Invoke a single test manually with SAM
sam local invoke ContentMailingFunction --event events/{test-name}.json --region us-west-2
# For newsCacheTablesRefresh (uses a different SAM resource name):
sam local invoke NewsCacheTablesRefreshFunction --event events/{test-name}.json --region us-west-2

# Invoke deployed function
sam remote invoke {FunctionName} --event-file events/{test-name}.json --region us-west-2
```

Test events are JSON files in `events/` named by use case and project (e.g., `web-user-signup-trivia-quest.json`, `mailing-question-selection-TH.json`). Test files with a `-validation-errors` suffix are expected to return errors. Test output goes to `events/output/`.

---

## Architecture Patterns

**Handler flow (web + mailing functions)**: `index.js handler` → extracts query string params → calls dedup service → delegates to Logic class → returns JSON/HTML response.

**Web and mailing functions** use the same handler pattern:
1. `ExtractQSParam(event, paramName, default)` / `ExtractQSInt()` to read query parameters
2. Routes to the appropriate Logic class method based on which parameters are present
3. Returns `{statusCode, headers, body}` with JSON (`application/json`) or HTML (`text/html`)

> **`newsCacheTablesRefresh` is different**: it is a scheduled internal function (EventBridge trigger), has no Logic class, makes no dedup calls, and is not an HTTP endpoint. Its `src/index.js` runs the cache RENAME swap directly.

**Web handler routing** (determined by query parameter presence, checked in this priority order):
- `q_id` (no `user_score`/`userSignUp`) → `webHeartBeat()` - single question lookup
- `user_score=true` → `userHighScore()` - get user's best score
- `leaderBoard=true` → `leaderBoard4()` - retrieve leaderboard
- `userSignUp=true` → `webUserLog()` - user registration/update
- `user_profile=true` → `profileQuestionLog2()` - user profile data
- `user_session_score=true` → `userSessionScore()` - current session score
- `get_profile_avatar=true` → `getProfileAvatar()` - avatar retrieval
- `get_user_stats=true` → `getUserStats()` - user statistics
- `category_id` present → `main()` - main question/content selection

**Dedup service**: External Lambda that prevents duplicate content delivery. Web functions use `DedupServiceGet` to fetch forbidden content IDs and `DedupServiceLog` to record what was served. The `dedup_service_project` query param identifies which project's dedup rules to apply. Trivia uses a different dedup service URL than the other projects.

**Database**: All functions connect to MySQL via `mysql2/promise` connection pool (`db.js`). Credentials come from environment variables (`db_host`, `db_user`, `db_password`, `db_name`) set in `template.yml` Parameters. Logic classes use `getProjectConfigValue(key)` to map `dedup_service_project` names to project-specific database table names.

**Web vs Mailing functions**: Web functions handle HTTP requests from users (gameplay, signup, leaderboards). Mailing functions generate email content (question selection, HTML formatting with `node-html-parser`). The `response_format` query param controls whether the response is JSON or HTML.

**CMS project** is different from others: it requires API key validation via `x-api-key` header (keys in `a_keys.production.json`) and handles user signup across all sub-projects from every project domain.

---

## Key Conventions

- Most functions are versioned at `v10` — **exception**: News mailing and newsCacheTablesRefresh are at `v11` in Prod (`News_Mailing_Prod_V11`, `News_CacheTablesRefresh_Prod_V11`)
- Lambda resource is always named `ContentMailingFunction` in SAM templates (even for web functions) — **exception**: `newsCacheTablesRefresh` uses `NewsCacheTablesRefreshFunction`
- Lambda function naming: `{Project}_{Type}_{Env}_V{N}` (e.g., `Trivia_Web_Prod_V10`, `News_Mailing_Prod_V11`)
- Runtime: `nodejs22.x`, Region: `us-west-2`, Memory: 128MB, Timeout: 20s — **exception**: `newsCacheTablesRefresh` uses Memory: 256MB, Timeout: 300s
- All functions run inside a shared VPC (same security group and subnets) for database access
- Lambda Function URLs (not API Gateway) provide HTTP endpoints with CORS enabled for all origins — **exception**: `newsCacheTablesRefresh` has no Function URL; it is triggered by EventBridge scheduler
- Each project's `dedup_service_project` whitelist is validated in its `index.js` — adding a new sub-project requires updating that whitelist
- Prod and Staging share code but point to different database configurations via template parameters
- All handler and Logic class methods are async; handlers set `context.callbackWaitsForEmptyEventLoop = false`
- Error responses always use status code 400; success responses use 200
- Logic classes return `{status, message, payload}` objects; `generateErrorResponse(msg)` is the standard error helper
- The `Deprecated/` and `UnregulatedEnv/` folders inside `Lambda_Regulated/` are not maintained and should be ignored

---

## Workflow & Debugging

**Diagnose before editing.** Do not jump to code edits until the root cause is confirmed and I have approved the investigation findings.

When an error is reported:
1. Read the relevant `src/index.js` and `src/{Project}Logic*.js` to understand current behaviour
2. Identify whether the issue is in the handler (routing/param extraction), the Logic class (DB query), the DedupService call, or the AWS infrastructure (Lambda Function URL throttle vs DynamoDB throttle vs RDS connection)
3. For 429 / rate-limit errors: distinguish between **Lambda Function URL `CallerRateLimitExceeded`** (AWS-level throttle on the Function URL endpoint) and **DynamoDB throttling** — they look similar but require different fixes
4. For DedupService errors: check whether `DedupServiceGet` or `DedupServiceLog` is failing and whether it affects only one project or all (shared URL vs Trivia-specific URL)
5. Present findings with the specific file path and line numbers before proposing any change
6. Wait for confirmation of the root cause before making any edits

---

## File Editing Conventions

**Always confirm the exact target file before editing.**

This repo has many near-identical copies across environments and versions. Before editing anything:

- **Prod vs Staging**: Trivia, Word, and News each have separate Prod and Staging function directories. News Staging has `mailing` and `newsCacheTablesRefresh` (no web in Staging). Confirm which environment is affected before editing
- **DedupService versions**: v1 (`dedup-api-v1/`) is legacy and not maintained. v2 is the current production version — active file is `dedup-prod2-no-legacy-opt.js`. v3 (`dedup-api-v3/`) is built but not yet deployed; its active file is `src/index.js`. Confirm which version is being targeted before editing
- **Web vs Mailing**: Each project has separate Logic files per function type — `NewsWebLogic.js` (web) and `NewsLogic.js` (mailing) are separate files in separate directories. A change to one does **not** apply to the other. If a fix must apply to both, edit both explicitly
- **index.js vs Logic class**: Routing and parameter extraction live in `src/index.js`; business logic lives in `src/{Project}Logic*.js`. Confirm which layer the change belongs to before editing
- When multiple candidate files exist, list them all and ask which one to modify rather than assuming

---

## Code Style / Conventions

**Make the smallest change that solves the problem.**

- Do not add new routing branches to `index.js` when the existing `ExtractQSParam` + priority-order routing already handles the case — extend the existing branch instead
- Do not restructure Logic class methods or add wrapper blocks when modifying a single behaviour; edit the specific lines that are wrong
- Do not add post-handler blocks or new switch cases when the existing `default` path or `generateErrorResponse()` already covers the scenario
- Do not rename, reorder, or reformat code surrounding the targeted change
- If a fix requires touching more than ~10 lines outside the specific bug location, flag this to me before proceeding — it likely means the scope is wider than expected

---

## Configuration

**Never hardcode values that are already config-driven.**

| Value | Where it lives | How to use it |
|-------|---------------|---------------|
| Database table names per sub-project | `getProjectConfigValue(key)` in Logic classes | Always use this method — never inline a table name string |
| DB credentials | `template.yml` Parameters → env vars (`db_host`, `db_user`, `db_password`, `db_name`) | Already injected by SAM; never copy credentials into code |
| Dedup DynamoDB table names | `tableDef` map in `dedup-prod2-no-legacy-opt.js` | Add new projects to `tableDef` only — never hardcode a table name inline |
| Sub-project whitelist | `index.js` per-function whitelist array | Update the array when adding a new sub-project; the dedup whitelist is auto-generated from `tableDef` keys |
| Dedup service URLs | `dedupApiV2` constant in `index.js` | Trivia uses a different URL than all other projects — do not swap or unify them |

If a value does not yet exist in config and needs to be added, add it to the appropriate config location first, then reference it — do not hardcode it in the logic.

---

## AWS / Lambda Scaling

**Every change must be validated against production scale before applying.**

Key production facts for this system:
- **~5 million emails/day** processed by the mailing Lambdas
- **Lambda Function URL** (not API Gateway) is the HTTP endpoint — it has a `CallerRateLimitExceeded` per-caller throttle that is separate from Lambda concurrency limits
- **DedupService** is called on every single mailing and web request — any latency or error introduced there multiplies across all projects
- **`ConsistentRead: false`** in DedupService DynamoDB reads is intentional (cost optimization, OPT 1) — do not change it to `true` without discussing the RCU cost impact
- **MySQL connection pool** in `db.js` is reused across Lambda warm invocations — never create a new `mysql.createPool()` inside a handler or Logic method

Before applying any fix:
1. Confirm the change is safe at 5M requests/day — if unsure, say so explicitly
2. After deploying, verify the fix is present in the live file by re-reading it (fixes can be reverted by a re-deploy of an old build artifact)
3. For DedupService changes, confirm the fix applies to the correct file (`dedup-prod2-no-legacy-opt.js`) and that the stack was redeployed, not just the file edited locally
