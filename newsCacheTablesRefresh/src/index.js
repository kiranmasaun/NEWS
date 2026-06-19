const pool = require('./db');

/**
 * Brand config: each entry defines one cache table to refresh.
 * NC yahoo/gmail each get their own ISP-filtered table. NC with no ISP falls back
 * to the original temp table in NewsLogic.js — no base NC cache table needed.
 * To add a new brand: add one entry here and redeploy.
 */
const NEWS_BRANDS = [
    {
        name:        'TN',
        cacheTable:  'articles_meta_cache_TN',
        projectKey:  'include_question_mail_TN',
        isp:         null,
    },
    {
        name:        'NC_yahoo',
        cacheTable:  'articles_meta_cache_NC_yahoo',
        projectKey:  'include_question_mail_NC',
        isp:         'yahoo',
    },
    {
        name:        'NC_gmail',
        cacheTable:  'articles_meta_cache_NC_gmail',
        projectKey:  'include_question_mail_NC',
        isp:         'gmail',
    },
    {
        name:        'NB',
        cacheTable:  'articles_meta_cache_NB',
        projectKey:  'include_question_mail_NB',
        isp:         null,
    },
];

/**
 * Build the INSERT...SELECT SQL for a brand.
 * Mirrors the exact JOIN used in NewsLogic.js createTempTable(),
 * but runs once here against the REPLICA instead of per-invocation.
 */
function buildRefreshSql(brand) {
    const newTable  = `${brand.cacheTable}_new`;
    const liveTable = brand.cacheTable;
    const oldTable  = `${brand.cacheTable}_old`;
    const col       = brand.projectKey;

    // ISP filter using blogs.category_id
    // yahoo: all articles including (category_id (2,7,1,4))
    // gmail: all articles including (category_id (2,7,1,4))
    let ispWhere = '';
    if (brand.name === 'NC_yahoo' || brand.name === 'NC_gmail') {
        ispWhere = 'AND b.category_id IN (2,7,1,4)';
    }

    return `
        DROP TABLE IF EXISTS NewsEngine.${newTable};

        CREATE TABLE NewsEngine.${newTable} (
            id                       varchar(30)   NOT NULL UNIQUE,
            slug                     varchar(1000) NOT NULL,
            title                    varchar(500)  NOT NULL,
            short_headlines          varchar(500)  DEFAULT NULL,
            author_name              varchar(255)  DEFAULT NULL,
            publish_date             datetime      DEFAULT NULL,
            markdown_content         longtext      NOT NULL,
            category_id              int           NOT NULL,
            category_name            varchar(100),
            priority                 INTEGER       NOT NULL,
            calculated_priority      INTEGER       NOT NULL,
            fileName                 varchar(200),
            ${col}                   INTEGER       NOT NULL,
            priority_rank_created_at timestamp     NULL DEFAULT NULL,
            created_at               timestamp     NULL DEFAULT CURRENT_TIMESTAMP,
            modified_at              timestamp     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );

        INSERT INTO NewsEngine.${newTable}
            (id, slug, title, short_headlines, author_name, publish_date, markdown_content,
             category_id, category_name, priority, calculated_priority, fileName, ${col},
             priority_rank_created_at)
        SELECT
            b.id, b.slug, b.title, b.short_headlines, b.author_name, b.publish_date,
            b.markdown_content, b.category_id, ac.name, p.priority, p.calculated_priority,
            bi.file_name, p.${col}, p.created_at
        FROM   NewsEngine.priority_rank p
        INNER JOIN NewsEngine.blogs b        ON b.id  = p.blog_id
        LEFT  JOIN NewsEngine.blog_images bi ON b.id  = bi.blog_id
        LEFT  JOIN NewsEngine.categories  ac ON b.category_id = ac.id
        WHERE  p.${col} = 1 ${ispWhere};

        CREATE TABLE IF NOT EXISTS NewsEngine.${liveTable} LIKE NewsEngine.${newTable};

        DROP TABLE IF EXISTS NewsEngine.${oldTable};
        RENAME TABLE NewsEngine.${liveTable} TO NewsEngine.${oldTable},
                     NewsEngine.${newTable}  TO NewsEngine.${liveTable};
        DROP TABLE IF EXISTS NewsEngine.${oldTable};
    `;
}

/**
 * Refresh a single brand's cache table.
 * Uses RENAME TABLE for atomic swap — no window where the live table is empty.
 */
async function refreshBrand(brand) {
    const conn = await pool.getConnection();
    try {
        console.log(`[${brand.name}] Starting cache refresh for ${brand.cacheTable}`);
        const sql = buildRefreshSql(brand);
        await conn.query(sql);
        console.log(`[${brand.name}] Cache refresh complete`);
        return { brand: brand.name, status: 'success' };
    } catch (err) {
        console.error(`[${brand.name}] Cache refresh failed:`, err.message);
        return { brand: brand.name, status: 'error', error: err.message };
    } finally {
        conn.release();
    }
}

exports.handler = async (event) => {
    console.log('newsCacheTablesRefresh started', JSON.stringify(event));

    const results = [];
    for (const brand of NEWS_BRANDS) {
        const result = await refreshBrand(brand);
        results.push(result);
    }

    const errors = results.filter(r => r.status === 'error');
    if (errors.length > 0) {
        console.error('Some brands failed to refresh:', JSON.stringify(errors));
        throw new Error(`Cache refresh failed for: ${errors.map(e => e.brand).join(', ')}`);
    }

    console.log('All brands refreshed successfully:', JSON.stringify(results));
    return { statusCode: 200, body: JSON.stringify(results) };
};
