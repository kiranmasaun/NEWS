-- =============================================================================
-- News Mailing Cache Tables — Production V11 DDL
-- Database: NewsEngine (prod RDS)
-- Run this once before deploying the V11 mailing Lambda.
-- These tables replace the per-invocation CREATE TEMPORARY TABLE JOIN.
-- The newsCacheTablesRefresh Lambda populates them on schedule (3am PST).
-- =============================================================================


-- =============================================================================
-- TABLE: articles_meta_cache_TN  (topline_news brand)
-- =============================================================================

DROP TABLE IF EXISTS NewsEngine.articles_meta_cache_TN;

CREATE TABLE NewsEngine.articles_meta_cache_TN (
    id                       varchar(30)   NOT NULL,
    slug                     varchar(1000) NOT NULL,
    title                    varchar(500)  NOT NULL,
    short_headlines          varchar(500)  DEFAULT NULL,
    author_name              varchar(255)  DEFAULT NULL,
    publish_date             datetime      DEFAULT NULL,
    markdown_content         longtext      NOT NULL,
    category_id              int           NOT NULL,
    category_name            varchar(100)  DEFAULT NULL,
    priority                 int           NOT NULL,
    calculated_priority      int           NOT NULL,
    fileName                 varchar(200)  DEFAULT NULL,
    include_question_mail_TN int           NOT NULL,
    priority_rank_created_at timestamp     NULL DEFAULT NULL,
    created_at               timestamp     NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at              timestamp     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_id (id),
    KEY idx_category        (category_id),
    KEY idx_priority        (calculated_priority)
);

-- Initial population for TN
-- (After first deploy the newsCacheTablesRefresh Lambda will handle this on schedule)
INSERT INTO NewsEngine.articles_meta_cache_TN
    (id, slug, title, short_headlines, author_name, publish_date, markdown_content,
     category_id, category_name, priority, calculated_priority, fileName, include_question_mail_TN,
     priority_rank_created_at)
SELECT
    b.id, b.slug, b.title, b.short_headlines, b.author_name, b.publish_date,
    b.markdown_content, b.category_id, ac.name, p.priority, p.calculated_priority,
    bi.file_name, p.include_question_mail_TN, p.created_at
FROM   NewsEngine.priority_rank p
INNER JOIN NewsEngine.blogs        b  ON b.id          = p.blog_id
LEFT  JOIN NewsEngine.blog_images  bi ON b.id          = bi.blog_id
LEFT  JOIN NewsEngine.categories   ac ON b.category_id = ac.id
WHERE  p.include_question_mail_TN = 1;


-- =============================================================================
-- TABLE: articles_meta_cache_NB  (news_beyond brand)
-- =============================================================================

DROP TABLE IF EXISTS NewsEngine.articles_meta_cache_NB;

CREATE TABLE NewsEngine.articles_meta_cache_NB (
    id                       varchar(30)   NOT NULL,
    slug                     varchar(1000) NOT NULL,
    title                    varchar(500)  NOT NULL,
    short_headlines          varchar(500)  DEFAULT NULL,
    author_name              varchar(255)  DEFAULT NULL,
    publish_date             datetime      DEFAULT NULL,
    markdown_content         longtext      NOT NULL,
    category_id              int           NOT NULL,
    category_name            varchar(100)  DEFAULT NULL,
    priority                 int           NOT NULL,
    calculated_priority      int           NOT NULL,
    fileName                 varchar(200)  DEFAULT NULL,
    include_question_mail_NB int           NOT NULL,
    priority_rank_created_at timestamp     NULL DEFAULT NULL,
    created_at               timestamp     NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at              timestamp     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_id (id),
    KEY idx_category        (category_id),
    KEY idx_priority        (calculated_priority)
);

-- Initial population for NB
INSERT INTO NewsEngine.articles_meta_cache_NB
    (id, slug, title, short_headlines, author_name, publish_date, markdown_content,
     category_id, category_name, priority, calculated_priority, fileName, include_question_mail_NB,
     priority_rank_created_at)
SELECT
    b.id, b.slug, b.title, b.short_headlines, b.author_name, b.publish_date,
    b.markdown_content, b.category_id, ac.name, p.priority, p.calculated_priority,
    bi.file_name, p.include_question_mail_NB, p.created_at
FROM   NewsEngine.priority_rank p
INNER JOIN NewsEngine.blogs        b  ON b.id          = p.blog_id
LEFT  JOIN NewsEngine.blog_images  bi ON b.id          = bi.blog_id
LEFT  JOIN NewsEngine.categories   ac ON b.category_id = ac.id
WHERE  p.include_question_mail_NB = 1;


-- =============================================================================
-- TABLE: articles_meta_cache_NC_yahoo  (news_command — yahoo ISP variant)
-- =============================================================================

DROP TABLE IF EXISTS NewsEngine.articles_meta_cache_NC_yahoo;

CREATE TABLE NewsEngine.articles_meta_cache_NC_yahoo (
    id                       varchar(30)   NOT NULL,
    slug                     varchar(1000) NOT NULL,
    title                    varchar(500)  NOT NULL,
    short_headlines          varchar(500)  DEFAULT NULL,
    author_name              varchar(255)  DEFAULT NULL,
    publish_date             datetime      DEFAULT NULL,
    markdown_content         longtext      NOT NULL,
    category_id              int           NOT NULL,
    category_name            varchar(100)  DEFAULT NULL,
    priority                 int           NOT NULL,
    calculated_priority      int           NOT NULL,
    fileName                 varchar(200)  DEFAULT NULL,
    include_question_mail_NC int           NOT NULL,
    priority_rank_created_at timestamp     NULL DEFAULT NULL,
    created_at               timestamp     NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at              timestamp     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_id (id),
    KEY idx_category        (category_id),
    KEY idx_priority        (calculated_priority)
);

-- Initial population for NC_yahoo
-- yahoo= (category_id = (2,7,1,4) with NC brand_assignment)
INSERT INTO NewsEngine.articles_meta_cache_NC_yahoo
    (id, slug, title, short_headlines, author_name, publish_date, markdown_content,
     category_id, category_name, priority, calculated_priority, fileName, include_question_mail_NC,
     priority_rank_created_at)
SELECT
    b.id, b.slug, b.title, b.short_headlines, b.author_name, b.publish_date,
    b.markdown_content, b.category_id, ac.name, p.priority, p.calculated_priority,
    bi.file_name, p.include_question_mail_NC, p.created_at
FROM   NewsEngine.priority_rank p
INNER JOIN NewsEngine.blogs        b    ON b.id          = p.blog_id
LEFT  JOIN NewsEngine.blog_images  bi   ON b.id          = bi.blog_id
LEFT  JOIN NewsEngine.categories   ac   ON b.category_id = ac.id
WHERE  p.include_question_mail_NC = 1
AND    b.category_id IN (2,7,1,4);


-- =============================================================================
-- TABLE: articles_meta_cache_NC_gmail  (news_command — gmail ISP variant)
-- =============================================================================

DROP TABLE IF EXISTS NewsEngine.articles_meta_cache_NC_gmail;

CREATE TABLE NewsEngine.articles_meta_cache_NC_gmail (
    id                       varchar(30)   NOT NULL,
    slug                     varchar(1000) NOT NULL,
    title                    varchar(500)  NOT NULL,
    short_headlines          varchar(500)  DEFAULT NULL,
    author_name              varchar(255)  DEFAULT NULL,
    publish_date             datetime      DEFAULT NULL,
    markdown_content         longtext      NOT NULL,
    category_id              int           NOT NULL,
    category_name            varchar(100)  DEFAULT NULL,
    priority                 int           NOT NULL,
    calculated_priority      int           NOT NULL,
    fileName                 varchar(200)  DEFAULT NULL,
    include_question_mail_NC int           NOT NULL,
    priority_rank_created_at timestamp     NULL DEFAULT NULL,
    created_at               timestamp     NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at              timestamp     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_id (id),
    KEY idx_category        (category_id),
    KEY idx_priority        (calculated_priority)
);

-- Initial population for NC_gmail
-- gmail = (category_id = (2,7,1,4) with NC brand_assignment)
INSERT INTO NewsEngine.articles_meta_cache_NC_gmail
    (id, slug, title, short_headlines, author_name, publish_date, markdown_content,
     category_id, category_name, priority, calculated_priority, fileName, include_question_mail_NC,
     priority_rank_created_at)
SELECT
    b.id, b.slug, b.title, b.short_headlines, b.author_name, b.publish_date,
    b.markdown_content, b.category_id, ac.name, p.priority, p.calculated_priority,
    bi.file_name, p.include_question_mail_NC, p.created_at
FROM   NewsEngine.priority_rank p
INNER JOIN NewsEngine.blogs        b    ON b.id          = p.blog_id
LEFT  JOIN NewsEngine.blog_images  bi   ON b.id          = bi.blog_id
LEFT  JOIN NewsEngine.categories   ac   ON b.category_id = ac.id
WHERE  p.include_question_mail_NC = 1
AND    b.category_id IN (2,7,1,4);


-- =============================================================================
-- Verification queries — run after the above to confirm tables are populated
-- =============================================================================

SELECT 'articles_meta_cache_TN'       AS cache_table, COUNT(*) AS row_count FROM NewsEngine.articles_meta_cache_TN
UNION ALL
SELECT 'articles_meta_cache_NB'       AS cache_table, COUNT(*) AS row_count FROM NewsEngine.articles_meta_cache_NB
UNION ALL
SELECT 'articles_meta_cache_NC_yahoo' AS cache_table, COUNT(*) AS row_count FROM NewsEngine.articles_meta_cache_NC_yahoo
UNION ALL
SELECT 'articles_meta_cache_NC_gmail' AS cache_table, COUNT(*) AS row_count FROM NewsEngine.articles_meta_cache_NC_gmail;
