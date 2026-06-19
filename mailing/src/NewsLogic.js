// Library.js
const MD5 = require('md5');
const pool = require('./db'); // Use the shared global connection pool

class NewsLogic {
    /* Call the constructor with the parameters those will coming from Lambda and set them globally */
    constructor(templateId, ip, requestPath, queryString, email, jsonConfig, forbiddenQuestions, dedupeServiceProject, articlesArray, isp) {

        /**
         * @param {number} templateId - The ID of the template.
         * i.e 1-10
         */

        this.templateId = templateId;

        /**
         * @param {string} ip - The IP address of the user.
         * i.e 1.1.1.1
         */

        this.ip = ip;

        /**
         * @param {string} requestPath - The path of the request.
         * i.e (v1 / v2 / test / prod) it can be anything
         */

        this.requestPath = requestPath; 

        /**
         * @param {string} queryString - The query string of the request.
         * i.e key1=value1&key2=value2
         */

        this.queryString = queryString;

        /**
         * @param {string} email - The email of the user.
         */

        this.email = email;

        /**
         * @param {Array} jsonConfig - The JSON configuration for the questions.
         * i.e [{lookBackInterval: 30, qLimit: 10, dataType: 'intro', category: 'p1', priority: 1}]
         */

        try {
            this.jsonConfig = typeof jsonConfig === 'string' ? JSON.parse(jsonConfig) : jsonConfig;
        } catch (error) {
            console.error("Error parsing jsonConfig in constructor:", error);
            this.jsonConfig = [];
        }

        /**
         * @param {Array} forbiddenQuestions - The array of forbidden questions.
         * i.e [{blog_id: 1, activity_date: '2021-01-01T00:00:00Z'}]
         */

        try {
            this.forbiddenQuestions = (forbiddenQuestions && typeof forbiddenQuestions === 'string') ? JSON.parse(forbiddenQuestions) : forbiddenQuestions;
        } catch (error) {
            console.error("Error parsing forbiddenQuestions in constructor:", error);
            this.forbiddenQuestions = [];
        }

        /**
         * @param {string} dedupeServiceProject - The dedupe service project name.
         */

        this.dedupeServiceProject = dedupeServiceProject || 'news_command';

        /**
         * @param {Array} articlesArray - The question ids array.
         * i.e upto 1-10
         * It either retrieves questions by specific IDs (in articlesArray) or fetches random 10 questions if articlesArray is empty.
         * These static questions are not user/email specific.
         */

        try {
            this.articlesArray = (articlesArray && typeof articlesArray === 'string') ? JSON.parse(articlesArray) : articlesArray;
        } catch (error) {
            console.error("Error parsing articlesArray in constructor:", error);
            this.articlesArray = [];
        }

        /**
         * @param {string} isp - The ISP for mailing (e.g. 'yahoo', 'gmail'). Used to filter articles by ISP-specific eligibility.
         */

        this.isp = (typeof isp === 'string') ? isp.toLowerCase().trim() : '';

        /**
         * @param {number} intervalDaysForCorrect - This param is used to get user correct clicks under specific days i.e 90
         */

        this.intervalDaysForCorrect = 90;

        /**
         * @param {number} intervalDaysForIncorrect - This param is used to get user incorrect clicks under specific days i.e 30
         */

        this.intervalDaysForIncorrect = 30;

        /**
         * @param {number} remainingLimit - Track how many questions can be selected for this iteration
         */

        this.remainingLimit = 0; 

        /**
         * @param {string} tempTable - use temporary table instead of querying the database.
         * For live projects (TN, NC) this points to a pre-materialized cache table refreshed
         * by the newsCacheTablesRefresh Lambda. Non-live projects fall back to the original temp table.
         */

        const _cacheTableMap = {
            'topline_news':       'articles_meta_cache_TN',
            'news_command_yahoo': 'articles_meta_cache_NC_yahoo',
            'news_command_gmail': 'articles_meta_cache_NC_gmail',
            'news_beyond':        'articles_meta_cache_NB',
            // news_command with no ISP falls through to 'articles_meta_temp'
        };
        const _ISP_VARIANTS = ['yahoo', 'gmail'];
        const _mapKey = (this.dedupeServiceProject === 'news_command' && _ISP_VARIANTS.includes(this.isp))
            ? `news_command_${this.isp}`
            : this.dedupeServiceProject;
        this.tempTable = _cacheTableMap[_mapKey] || 'articles_meta_temp';
        console.log(`[TableRoute] project=${this.dedupeServiceProject} isp=${this.isp || 'none'} → table=${this.tempTable}`);
 
        /**
         * @param {number} queryRunCount - Counter to track the number of queries executed
         */

        this.queryRunCount = 0;
 
        /**
         * @param {boolean} useCache - Cache for query results
         */

        this.useCache = true;
 
        /**
         * @param {Object} queryResultsCache - used to store the results of queries
         */

        this.queryResultsCache = {
            hpClicksData: [], // Cache for hp_clicks data
            preferredCategoriesData: [], // Cache for preferred categories data
            templateData: [], // Cache for template data
            allCategoriesData: [] // Cache for all categories data if preferred categories are present"
        };
    }

    /**
     * Main entry point of the class. Orchestrates the process by:
     * - Retrieving forbidden questions with date differences.
     * - Determining the highest look-back interval from the configuration.
     * - Configuring and selecting questions based on the configuration.
     * @returns {Promise<Array>} - The selected queried questions.
     * i.e [{"id":j0t6zhYX7, "question": "abc", ...},{"id":j0t6zhYX7, "question": "abc", ...}, ...So on]
     */
    async main() {
        try {
            if (!Array.isArray(this.jsonConfig) || this.jsonConfig.length === 0) throw new Error('this.jsonConfig is empty or not an array');

            // Step 1: Create temporary table
            let results = await this.createTempTable();
            if (!results) throw new Error('Error while creating temporary table');

            // Fallback: if cache table is empty or unreachable, fall back to temp table
            if (this.tempTable !== 'articles_meta_temp') {
                try {
                    const countResult = await this.executeQuery(`SELECT COUNT(*) AS cnt FROM NewsEngine.${this.tempTable}`);
                    const rowCount = (Array.isArray(countResult) && countResult[0]) ? countResult[0].cnt : 0;
                    if (rowCount === 0) {
                        console.warn(`[CacheFallback] ${this.tempTable} is empty — falling back to temp table`);
                        this.tempTable = 'articles_meta_temp';
                        const fallbackResult = await this.createTempTable();
                        if (!fallbackResult) throw new Error('Error while creating fallback temporary table');
                    } else {
                        console.log(`[CacheReady] Cache table confirmed: ${this.tempTable} (${rowCount} rows)`);
                    }
                } catch (fallbackErr) {
                    // Cache table unreachable (e.g. table missing, RDS error) — fall back to temp table
                    console.warn(`[CacheFallback] Cache table check failed (${fallbackErr.message}) — falling back to temp table`);
                    this.tempTable = 'articles_meta_temp';
                    const fallbackResult = await this.createTempTable();
                    if (!fallbackResult) throw new Error('Error while creating fallback temporary table');
                }
            }

            // check if there is ps or p in the category for preferred categories
            const isPreferredCategoryExists = this.jsonConfig.find(config => typeof config.category === 'string' && config.category.includes('p'));

            // Step 2: Execute queries and cache results if this.useCache is true
            if (this.useCache) {
                results = await this.executeQueriesAndCache(isPreferredCategoryExists);
                if (!results) throw new Error('Error while executing multiple queries at once');
            }

            // Step 3: Calculate forbidden questions (Add Diff Days to Forbidden Questions)
            results = await this.addDiffDaysToForbiddenQuestions();
            if (!results) throw new Error('Error while calculating forbidden questions');

            // Step 4: Get question configuration To handle all the questions and selection logic
            const questions = await this.questionConfiguration(isPreferredCategoryExists);

            // Step 5: Drop temporary table — only for non-live projects using the real temp table.
            // Live projects (TN, NC) use a persistent cache table managed by newsCacheTablesRefresh.
            if (this.tempTable === 'articles_meta_temp') {
                const sql = `DROP TEMPORARY TABLE IF EXISTS NewsEngine.${this.tempTable}`;
                await this.executeQuery(sql);
            }

            // console.log('queryRunCount ', this.queryRunCount);

            if (!questions.status) throw new Error(`Error fetching questions: ${questions.message}`);

            // Final success response
            return {
                status: true,
                message: 'Questions fetched successfully',
                payload: questions.payload
            };
        } catch (error) {
            console.error('Error executing main function:', error);
            return this.generateErrorResponse(`Error executing main function: ${error.message}`);
        }
    }

    // Utility function for generating error responses
    generateErrorResponse(message) {
        return {
            status: false,
            message: message,
            payload: []
        };
    }

    /**
     * Get a column or table name based on project and key
     * @param {string} key - The config key to retrieve (e.g., 'include_question_mail', 'table_name')
     * @returns {string} The corresponding value from the project config
     */
    getProjectConfigValue(key) {
        const projectConfig = {
            news_command: {
                include_question_mail: 'include_question_mail_NC',
                project_key: 'NC',
                cid: 9187
            },
            truth_facts: {
                include_question_mail: 'include_question_mail_TF',
                project_key: 'TF',
                cid: 9089
            },
            topline_news: {
                include_question_mail: 'include_question_mail_TN',
                project_key: 'TN',
                cid: 9233
            },
            news_beyond: {
                include_question_mail: 'include_question_mail_NB',
                project_key: 'NB',
                cid: 9187
            },
            all_news: {
                include_question_mail: 'include_question_mail_ATN',
                project_key: 'ATN',
                cid: 9187
            }
        };

        const config = projectConfig[this.dedupeServiceProject] || projectConfig['news_command'];
        return config[key];
    }

    /**
     * Create table to store questions temporarily and insert data into it.
     * @returns {Promise<boolean>} - A boolean indicating the success of the operation.
    */
    async createTempTable() {
        // Live projects use a pre-built persistent cache table — skip temp table creation.
        if (this.tempTable !== 'articles_meta_temp') {
            console.log(`[CacheTable] Using pre-built cache table: ${this.tempTable} — skipping temp table creation`);
            return true;
        }

        try {
            const include_question_mail = this.getProjectConfigValue('include_question_mail');

            // Build ISP join and WHERE condition dynamically using project_key + isp
            // Column name pattern: {isp}_{project_key}  e.g. yahoo_NC, gmail_NC
            // Adding a new project+ISP: ALTER TABLE priority_rank_isp_flags ADD COLUMN {isp}_{key} TINYINT(1) NOT NULL DEFAULT 0
            let ispJoin = '';
            let ispWhereCondition = '';
            const isps = ['yahoo', 'gmail'];
            if (this.dedupeServiceProject === 'news_command' && this.isp && isps.includes(this.isp)) {
                const projectKey = this.getProjectConfigValue('project_key');
                const ispColumn = `${this.isp}_${projectKey}`;
                ispJoin = `LEFT JOIN NewsEngine.priority_rank_isp_flags isp_f ON isp_f.blog_id = p.blog_id`;
                ispWhereCondition = `AND isp_f.${ispColumn} = 1`;
            }

            // Create the temporary table and insert the data in a single query
            const createTempTableAndInsertSql = `
            CREATE TEMPORARY TABLE IF NOT EXISTS NewsEngine.${this.tempTable} (
                id varchar(30) NOT NULL UNIQUE,
                slug varchar(1000) NOT NULL,
                title varchar(500) NOT NULL,
                short_headlines varchar(500) DEFAULT NULL,
                author_name varchar(255) DEFAULT NULL,
                publish_date datetime DEFAULT NULL,
                markdown_content longtext NOT NULL,
                category_id int NOT NULL,
                category_name varchar(100),
                priority INTEGER NOT NULL,
                calculated_priority INTEGER NOT NULL,
                fileName varchar(200),
                ${include_question_mail} INTEGER NOT NULL);

                INSERT INTO NewsEngine.${this.tempTable} (id, slug, title, short_headlines, author_name, publish_date, markdown_content, category_id, category_name, priority, calculated_priority, fileName, ${include_question_mail})
                SELECT b.id, b.slug, b.title, b.short_headlines, b.author_name, b.publish_date, b.markdown_content, b.category_id, ac.name, p.priority, p.calculated_priority, bi.file_name, p.${include_question_mail}
                FROM NewsEngine.priority_rank p
                INNER JOIN NewsEngine.blogs b ON b.id = p.blog_id
                LEFT JOIN NewsEngine.blog_images bi ON b.id = bi.blog_id
                LEFT JOIN NewsEngine.categories ac ON b.category_id = ac.id
                ${ispJoin}
                WHERE p.${include_question_mail} = 1
                ${ispWhereCondition};
            `;

            await this.executeQuery(createTempTableAndInsertSql);

            return true;
        } catch (error) {
            console.error('Error creating temporary table:', error);
            return false;
        }
    }

    /**
     * getArticlesWithImage function is used to fetch articles from the database.
     * It either retrieves articles by specific IDs or fetches random articles if this.articlesArray is empty.
     * Each article includes details such as b.id, b.slug, b.title, b.author_name, b.publish_date, b.markdown_content, b.category_id, c.name, p.priority, p.calculated_priority, bi.file_name.
     * @returns {Promise<Array>} An array of selected articles with associated metadata.
     */
    async getArticlesWithImage() {
        try {
            // Get article IDs from the articlesArray
            const articlesIds = this.articlesArray[0]?.articles_list || [];

            let selectedArticles = [];
            const selectionCase = 6;

            let sql = `SELECT b.id, b.id as blog_id, b.slug, b.title, b.author_name, b.publish_date, 
                CONCAT(
                    SUBSTRING_INDEX(b.markdown_content, ' ', 50),
                    '...Read More'
                ) AS short_content, b.category_id, c.name AS category_name, p.priority, p.calculated_priority, bi.file_name AS fileName, ${selectionCase} AS selectionCase
                FROM 
                    NewsEngine.blogs b
                LEFT JOIN 
                    NewsEngine.blog_images bi ON b.id = bi.blog_id
                LEFT JOIN 
                    NewsEngine.categories c ON b.category_id = c.id
                LEFT JOIN 
                    NewsEngine.priority_rank p ON b.id = p.blog_id`;
        
            // If we have article IDs, fetch them from the database
            if (articlesIds.length > 0) {
                const idList = articlesIds.map(id => `'${id}'`).join(',');
                sql = `${sql} WHERE b.id IN (${idList}) ORDER BY FIELD(b.id, ${idList})`;
            } else {
                // If no valid article IDs, fetch 10 random articles
                sql = `${sql} 
                    ORDER BY 
                        RAND() 
                    LIMIT 10`;
            }
                
            selectedArticles = await this.executeQuery(sql); 

            // Fetch template data if necessary
            let template = null;
            if (this.templateId > 0) template = await this.getDataFromTable('templates', selectionCase);

            // Add the template to the selected articles if it exists
            if (template) selectedArticles.push(template);
            
            return {
                status: true,
                message: 'Articles fetched successfully',
                payload: selectedArticles
            };
        } catch (error) {
            console.error('Error fetching articles:', error);
            return this.generateErrorResponse(`Error fetching articles: ${error.message}`);
        }
    }

    /**
     * Execute multiple queries at once and cache the results for future use.
     * @param {Object} isPreferredCategoryExists - The object containing the preferred category details.
     * @returns {Promise<boolean>} - A boolean indicating the success of the operation.
     */
    async executeQueriesAndCache(isPreferredCategoryExists) {
        try {
            const cid = this.getProjectConfigValue('cid');

            let prefSQl = '';
            // if isPreferredCategoryExists is found, set the sql query based on the category
            if (isPreferredCategoryExists) {
                let sql = '';
                if (isPreferredCategoryExists.category.includes('p')) sql = 'SELECT id FROM NewsEngine.categories';

                prefSQl = `SELECT cat_json 
                    FROM NewsEngine.preferred_categories
                    WHERE user = '${MD5(this.email)}';
                    ${sql}`;
            }

            const multipleSqlQueries = `
                SELECT blog_id, created_at AS 'timestamp', 0 AS diffDays
                FROM NewsEngine.hp_clicks
                WHERE e_hash = '${MD5(this.email)}'
                AND choice_selected = 1
                AND created_at > NOW() - INTERVAL ${this.intervalDaysForCorrect} DAY
                AND cid = ${cid};

                SELECT template FROM NewsEngine.templates WHERE id = (
                    CASE
                        WHEN (
                            SELECT
                                1 = 1
                            FROM
                                NewsEngine.templates
                            WHERE
                                id = ${this.templateId}
                        ) THEN ${this.templateId}
                        ELSE 1
                    END
                );
                
                ${prefSQl}
            `;
            
            // Execute multiple queries at once
            const results = await this.executeQuery(multipleSqlQueries);

            // Cache the results for future use
            this.queryResultsCache.hpClicksData = (results[0] && results[0].length > 0) ? results[0] : [];
            this.queryResultsCache.templateData = (results[1] && results[1].length > 0) ? results[1][0] : [];
            this.queryResultsCache.preferredCategoriesData = (results[2] && results[2].length > 0) ? results[2][0] : [];
            this.queryResultsCache.allCategoriesData = (results[3] && results[3].length > 0) ? results[3] : [];

            return true;
        } catch (error) {
            console.error('Error while executing multiple queries at once:', error);
            return false;
        }
    }

    /**
     * Computes the difference in days between the current date and the activity dates of forbidden questions.
     * Also retrieves recent questions from the 'hp_clicks' table, computes their date differences,
     * and combines them with the forbidden questions.
     * @returns {Promise<Array>} - An array of forbidden questions with date differences.
     * i.e BEFORE [{blog_id: 1, activity_date: '2021-01-01T00:00:00Z'}] 
     * AFTER [{blog_id: 1, activity_date: '2024-08-01T00:00:00Z', diffDays: 30}]
     */
    async addDiffDaysToForbiddenQuestions() {
        try {
            const currentDate = new Date();
        
            // Add date difference to each forbidden question
            if (this.forbiddenQuestions.length > 0) {
                this.forbiddenQuestions.forEach(question => {
                    const activityDate = new Date(question.activity_date);
                    question.diffDays = Math.floor((currentDate - activityDate) / (1000 * 60 * 60 * 24));
                });
            }
        
            // Retrieve blog_ids from the hp_clicks table that are clicked under 90 days by specific user
            let hpClicks = this.queryResultsCache.hpClicksData;
            
            // Fetch data from the database if cache is false
            if (!this.useCache) hpClicks = await this.getDataFromTable('hp_clicks');

           // Combine forbidden questions with hp_clicks data if available
           if (hpClicks && hpClicks.length > 0) this.forbiddenQuestions = this.forbiddenQuestions.concat(hpClicks);
            
           return true;
        } catch (error) {
            console.error('Error while calculating forbidden questions.: ', error);
            return false;
        }
    }

    /**
     * Manages the configuration and selection of questions based on categories.
     * Handles preferred categories, limits, priorities, and any necessary templates to generate the list of questions.
     * @returns {Promise<Array>} - An array of objects selected questions.
     * i.e [{"id":j0t6zhYX7, "question": "abc", ...},{"id":j0t6zhYX7, "question": "abc", ...}, ...So on]
     */
    async questionConfiguration(isPreferredCategoryExists) {
        try {
            let catJson = {};
            // Check if preferred categories are present
            if (isPreferredCategoryExists) {
                // Get the preferred category/sub-category using the email
                const prefCat = await this.getPrefCatByEmail();

                catJson = (typeof prefCat.catJson === 'string') ? JSON.parse(prefCat.catJson) : prefCat.catJson;
            }

            // Initialize variables
            let selectedQuestions = [];
            let questionLimit = 0;

            // Loop through each configuration item in the jsonConfig array and select questions accordingly 
            // based on the category, priority, lookBackInterval, and other conditions
            // The selected questions are stored in the selectedQuestions array
            for (let i = 0; i < this.jsonConfig.length; i++) {
                let { qLimit, dataType, category, priority, lookBackInterval } = this.jsonConfig[i];
                qLimit = Number(qLimit);
                let categoryCount = 0; // To track the number of categories based on configuration
                let categoryId = category;
                let catStr = '';
                let preferredCatPresent = false;
                let categoryPosition = 0;  // To track preferred category position
                let allCats = []; // To hold all categories

                // Check if the category is of type "p" (preferred categories)
                if (typeof category === 'string' && category.includes("p")) {
                    allCats = this.queryResultsCache.allCategoriesData;

                    // If cache is false, fetch data from the database
                    if (!this.useCache) allCats = await this.getDataFromTable('categories');

                    preferredCatPresent = true; 
                    categoryPosition = category.replace("p", ""); // Extract the position from the category string, e.g., "p1" becomes "1"
                    // Get the count of subcategories based on the extracted position
                    categoryCount = catJson.cats[categoryPosition] ? catJson.count : 0;
                    // If category count is invalid, set categoryId to 0; otherwise, set it based on categories
                    categoryId = (categoryCount < 1 || !catJson.cats[categoryPosition]) ? categoryId = 0 : catJson.cats[categoryPosition] || 0;
                } // Check if the categoryId includes multiple categories
                else if (typeof categoryId === 'string' && categoryId.includes(",")) {
                    // add category string by comma
                    catStr = `'${categoryId}'`;
                } // else { // nothing needed, general operation will be performed e.g. category = 6 etc. }

                // Handle forbidden questions and deduplication based on lookBackInterval
                let questionsWithinInterval = new Set();
                for (const result of this.forbiddenQuestions) {
                    if (result.diffDays <= lookBackInterval) {
                        questionsWithinInterval.add(result.blog_id);
                    }
                }
                // Convert Set to comma-separated string for SQL queries or list filtering
                questionsWithinInterval = Array.from(questionsWithinInterval).join(", ") || '0';

                let selQuestion = []; // To store the selected questions based on the query results
                this.remainingLimit = qLimit; // Track how many questions can be selected for this iteration
                questionLimit = questionLimit + qLimit; // Update total question limit by adding current qLimit

                // Main logic to handle preferred or normal category selections
                if ((!preferredCatPresent || categoryCount === 0) && catStr === '') {
                    // Select questions normally without preferred categories
                    selQuestion = await this.getQuestions(Number(categoryId), this.remainingLimit, priority, 0, i === this.jsonConfig.length - 1, i, dataType, questionsWithinInterval, selectedQuestions);
                    
                    if (selQuestion.status === false) throw new Error(`Error fetching questions: ${selQuestion.message}`);

                    // If questions are returned, add them to the selectedQuestions array
                    if (selQuestion.length > 0) selectedQuestions.push(...selQuestion);

                } else if (catStr !== '') { // Handle multiple categories
                    // Select questions based on multiple categories
                    selQuestion = await this.getQuestions(catStr, this.remainingLimit, priority, 0, i === this.jsonConfig.length - 1, i, dataType, questionsWithinInterval, selectedQuestions);
                    
                    if (selQuestion.length > 0) selectedQuestions.push(...selQuestion);
                } else {
                    // Preferred category selection logic: Choose questions from preferred categories first
                    let preferredCategories = [];  // To hold preferred categories for selection
                    let preferredIteration = 0; // Counter to track the number of iterations over preferred categories
                    
                    // Separate preferred categories from other categories
                    while (preferredIteration < categoryCount) {
                        if (typeof category === 'string' && category.includes("p")) {
                            if (catJson.cats[categoryPosition]) preferredCategories.push(Number(catJson.cats[categoryPosition]));
                        } // else { // nothing needed }

                        preferredIteration++;  // Increment the iteration counter for preferred categories
                        categoryPosition++;  // Move to the next position for subcategories or categories
                    }

                    let otherCategories = [];  // To hold other categories (non-preferred) for selection

                    // Separate other categories by filtering out the preferred ones
                    if (typeof category === 'string' && category.includes("p")) {
                        otherCategories = allCats.filter(item => !preferredCategories.includes(item.id));
                    } // else { // nothing needed }

                    // Fallbacks: These are different selection stages to ensure enough questions are selected from various categories and conditions

                    // 1) All preferred categories, same priority
                     // This tries to fetch questions from preferred categories, and priority level as specified.
                    await this.fetchQuestions(questionLimit, priority, i, dataType, questionsWithinInterval, selectedQuestions, preferredCategories, true); 

                    // 2) Other categories, same priority
                    // If there aren't enough questions selected, it fetches questions from "other" categories (non-preferred categories) while keeping the same priority level.
                    if (selectedQuestions.length < questionLimit) await this.fetchQuestions(questionLimit, priority, i, dataType, questionsWithinInterval, selectedQuestions, otherCategories, true, 0.1, true); 

                    // 3) All preferred categories, different priority
                    // If still not enough questions, it fetches questions from preferred categories allowing for different priority levels.
                    if (selectedQuestions.length < questionLimit) await this.fetchQuestions(questionLimit, priority, i, dataType, questionsWithinInterval, selectedQuestions, preferredCategories, false, 0.2); 

                    // 4) Other categories, different priority
                    // Finally, if still not enough questions, it fetches questions from "other" categories with different priority levels.
                    if (selectedQuestions.length < questionLimit) await this.fetchQuestions(questionLimit, priority, i, dataType, questionsWithinInterval, selectedQuestions, otherCategories, false, 0.3, true);

                    // 5) Remove deduplicated questions from selectedQuestions
                    // After fetching the questions, we want to remove any deduplicated questions from the final selection.
                    if (selectedQuestions.length < questionLimit) await this.fetchQuestions(questionLimit, priority, i, dataType, questionsWithinInterval, selectedQuestions, otherCategories, false, 0.4, true, false);
                }
            }
            // console.log('selectedQuestions.length ', selectedQuestions.length);

            // Return final selected questions
            return {
                status: true,
                message: 'Questions fetched successfully',
                payload: selectedQuestions
            };

        } catch (error) {
            console.error('Error getting selection questions:', error);
            return this.generateErrorResponse(`Error getting selection questions: ${error.message}`);
        }
    }

    /**
     * fetchQuestions: Helper function to retrieve questions based on selected categories, filters, and conditions.
     * 
     * This function is responsible for:
     * - Fetching questions from specific categories based on the user's selection and the conditions specified.
     * - Handling preferred categories (if any), and fetching questions from the parent categories if there are not enough questions in the selected subcategories.
     * - Applying filters for priority, and ensuring deduplication of questions if necessary.
     * - This function iterates over the selected categories and fetches questions for each category until the remaining question limit is met.
     */ 
    async fetchQuestions(questionLimit, priority, iterator, dataType, questionsWithinInterval, selectedQuestions, selectedCategories, isSamePriorityLevel, selectionCase = 0, shouldDedupe = true) {
        try { 
            // Iterate over each category to fetch questions. The `getQuestions` function is called for each category.
            for (let category of selectedCategories) {
                let categoryId = (category.id) ? category.id : category;

                // This function is responsible for querying the database and applying all necessary filters.
                let fetchedQuestions = await this.getQuestions(categoryId, this.remainingLimit, priority, 1, iterator === this.jsonConfig.length - 1, iterator, dataType, questionsWithinInterval, selectedQuestions, isSamePriorityLevel, selectionCase, shouldDedupe);

                if (fetchedQuestions.status === false) throw new Error(`Error fetching questions: ${fetchedQuestions.message}`);

                // Update the remaining limit after fetching questions
                this.remainingLimit -= fetchedQuestions.length;

                // If questions are fetched, add them to the selectedQuestions array
                if (fetchedQuestions.length > 0) selectedQuestions.push(...fetchedQuestions);

                // Stop fetching questions if we have reached the remaining limit or the total question limit
                if (this.remainingLimit <= 0 || selectedQuestions.length >= questionLimit) break;
            }

            return true;
        } catch (error) {
            console.error('Error fetching preferred category questions:', error);
            return this.generateErrorResponse(`Error fetching preferred category questions: ${error.message}`);
        }
    } 
    
    /**
     * Retrieves the preferred categories for the given email from the 'preferred_categories' table.
     * @returns {Promise<Object>} - An object containing preferred categories.
     * i.e { category : {"cats": {"1": 2, "2": 5}, "count": 2}}
     */
    async getPrefCatByEmail() {
        // SELECT preferred cat/sub-cat query here using "this.email"
        let preferredCat = this.queryResultsCache.preferredCategoriesData;

        // Fetch data from the database if cache is false
        if (!this.useCache) preferredCat = await this.getDataFromTable('preferred_categories');

        let catJson = {"cats": {}, "count": 0};
        // If categories are empty the set '{"cats": {}, "count": 0}';
        if (preferredCat && "cat_json" in preferredCat && preferredCat.cat_json !== '') {
            catJson = preferredCat.cat_json;
        }

        return { catJson }
    }

    /**
     * Fetches data from a specified table based on the table name.
     * Supports different queries for different tables and returns the result.
     * @param {string} tableName - The name of the table to query.
     * @param {number} [selectionCase=0] - The case number to determine which query to execute.
     * @returns {Promise<Array>} - The queried data.
     */
    async getDataFromTable(tableName, selectionCase = 0, dataType = '') {
        try {
            const cid = this.getProjectConfigValue('cid');

            let sql ='';
            if (tableName === 'hp_clicks') {
                sql = `SELECT blog_id, created_at AS 'timestamp', 0 AS diffDays
                FROM NewsEngine.hp_clicks
                WHERE e_hash = '${MD5(this.email)}'
                AND choice_selected = 1
                AND created_at > NOW() - INTERVAL ${this.intervalDaysForCorrect} DAY
                AND cid = ${cid}`;
            } else if (tableName === 'templates') {
                const dataTypeClause = dataType ? `${dataType} as dataType,` : '';
                sql = `SELECT template, ${dataTypeClause} ${selectionCase} as selectionCase FROM NewsEngine.${tableName} WHERE id = (
                    CASE
                        WHEN (
                            SELECT
                                1 = 1
                            FROM
                                ${tableName}
                            WHERE
                                id = ${this.templateId}
                        ) THEN ${this.templateId}
                        ELSE 1
                    END
                );`;
            } else if (tableName === 'categories') {
                sql = `SELECT id FROM NewsEngine.${tableName}`;
            } else {
                sql = `SELECT cat_json FROM NewsEngine.${tableName} WHERE user = '${MD5(this.email)}'`;
            }

            const result = await this.executeQuery(sql); 

            return (result.length > 0 && tableName !== 'hp_clicks' && tableName !== 'categories') ? result[0] : result;
        } catch (error) {
            console.error('Error getting data from table:', error);
            return this.generateErrorResponse(`Error getting data from table: ${error.message}`);
        }
    }

    /**
     * Retrieves questions from the GetData8 procedure based on various parameters.
     * Aggregates questions according to different criteria and configurations.
     * @param {number} categoryId - The category ID for the questions.
     * @param {number} qLimit - The limit of questions to retrieve.
     * @param {number} priority - The priority of the questions.
     * @param {boolean} addTemplate - Whether to add a template.
     * @param {number} iterator - The iterator for question selection.
     * @param {boolean} isPreferredRun - Indicates if the run is preferred.
     * @param {number} isEnabledWeb - Indicates if web is enabled.
     * @param {number} isEnabledEmail - Indicates if email is enabled.
     * @param {string} dataType - The type of data to retrieve.
     * @param {string} questionsWithinInterval - The questionsWithinInterval is qIds should be exclude for question selection.
     * @returns {Promise<Array>} - An array of retrieved questions.
     */
    async getQuestionsFromSelectionLogic(categoryId, qLimit, priority, addTemplate, iterator, isPreferredRun, dataType, questionsWithinInterval, selectedQuestions, isSamePriorityLevel, selectionCase, shouldDedupe) {
        // Get category and run the queries according to it
        const counts = await this.getQuestionsCount(priority, categoryId, questionsWithinInterval, dataType);
        if (!counts) throw new Error('Questions counts are undefined or empty');

        // Run a common insertion operation according to the condition
        //if categoryQuestionCountDedupe, categoryQuestionCountNoDedupe, nonCategoryQuestionCountDedupe then insertion operation will performed
        const allSelectedQuestions = await this.getSelectedQuestions(counts, isPreferredRun, qLimit, iterator, priority, categoryId, dataType, questionsWithinInterval, addTemplate, selectedQuestions, isSamePriorityLevel, selectionCase, shouldDedupe);
        if (!allSelectedQuestions) throw new Error('Error while getting questions from selection logic');

        return allSelectedQuestions;
    }

    /* Get all types of category counts according to the condition */
    async getQuestionsCount(priority, categoryId, questionsWithinInterval, dataType) {

        try {
            // Run the query for cat with Dedupe, cat without Dedupe and no cat with dedupe condition 
            // Note: The query will be common but according to the conditions
            // Get all the 3 counts from a query

            // Get the field order based on dataType
            const fieldOrder = this.getFieldOrder(dataType);

            const include_question_mail = this.getProjectConfigValue('include_question_mail');

            const countQuery = `WITH questions_filtered AS (
                SELECT id, category_id, ${include_question_mail}, calculated_priority 
                FROM NewsEngine.${this.tempTable} 
            ),
            common_conditions AS (
                SELECT
                    id, 
                    CASE 
                        WHEN ${categoryId} = 0 THEN 1  
                        ELSE FIND_IN_SET(category_id, ${categoryId}) > 0
                    END AS category_condition,
                    FIND_IN_SET(category_id, ${categoryId}) = 0 AS non_category_condition,
                    (CASE 
                        WHEN '${dataType}' IN ('ret-openers', 'ret-clickers') THEN FIELD(calculated_priority, ${fieldOrder}) >= FIELD(${priority}, ${fieldOrder})
                        ELSE calculated_priority >= ${priority}
                    END) AS priority_condition
                FROM questions_filtered
            )

            SELECT
                ######### SELECTION CASE 1 #########
                SUM(
                    category_condition
                    AND ${priority} > 0
                    AND priority_condition
                    AND CASE 
                        WHEN "${questionsWithinInterval}" IS NULL OR "${questionsWithinInterval}" = "" THEN TRUE ELSE id NOT IN (${questionsWithinInterval}) 
                    END
                ) AS categoryQuestionCountDedup,

                ######### SELECTION CASE 2 #########
                SUM(
                    non_category_condition
                    AND CASE 
                        WHEN "${questionsWithinInterval}" IS NULL OR "${questionsWithinInterval}" = "" THEN TRUE ELSE id NOT IN (${questionsWithinInterval})
                    END
                ) AS nonCategoryQuestionCountDedupNoPriority,

                ######### SELECTION CASE 3 #########
                SUM(
                    category_condition
                    AND CASE 
                        WHEN "${questionsWithinInterval}" IS NULL OR "${questionsWithinInterval}" = "" THEN TRUE ELSE id NOT IN (${questionsWithinInterval})
                    END
                ) AS categoryQuestionCountDedupNoPriority,

                ######### SELECTION CASE 4 #########
                SUM(
                    non_category_condition
                    AND ${priority} > 0
                    AND priority_condition
                    AND CASE 
                        WHEN "${questionsWithinInterval}" IS NULL OR "${questionsWithinInterval}" = "" THEN TRUE ELSE id NOT IN (${questionsWithinInterval})
                    END
                ) AS nonCategoryQuestionCountDedup

            FROM common_conditions;`;
            
            const result = await this.executeQuery(countQuery);
            // console.log('queryCount',result);
            
            return  result.length > 0 ? result[0] : result;
        } catch (error) {
            console.error('Error getting questions counts from query:', error);
            return false;
        }
    }

    /* Function to get field order based on dataType */
    getFieldOrder(dataType) {
        switch (dataType) {
            case 'intro':
            case 'reactivation':
            case 'ret-openers':
                return '1, 2, 3, 6, 4, 5'; // OLD ORDER: 1, 2, 3, 4, 5, 6
            case 'ret-clickers':
                return '3, 6, 1, 2, 4, 5'; // OLD ORDER: 6, 1, 2, 3, 4, 5
            default:
                return '1, 2, 3, 4, 5, 6, 7';
        }
    }

    /* Get Selected Questions */
    async getSelectedQuestions(counts, isPreferredRun, qLimit, iterator, priority, categoryId, dataType, questionsWithinInterval, addTemplate, selectedQuestions, isSamePriorityLevel, selCase, shouldDedupe) {
        // make it common for all the select queries and according to condition
        // console.log('categoryId', categoryId);

        try {
            const include_question_mail = this.getProjectConfigValue('include_question_mail');

            let idsToExclude;

            // Get the field order based on dataType
            const fieldOrder = this.getFieldOrder(dataType);
            idsToExclude = this.commaSeparationQuestionsConversion(selectedQuestions);
            let selectionQuery;

            const baseQuery = `SELECT b.id, b.id as blog_id, b.title, b.slug, b.author_name, 
                CONCAT(
                    SUBSTRING_INDEX(b.markdown_content, ' ', 50),
                    '...Read More'
                ) AS short_content,
                b.category_id, b.category_name, b.calculated_priority, b.${include_question_mail}, b.fileName AS fileName, ${iterator} as iteration  
                FROM NewsEngine.${this.tempTable} b
                WHERE (CASE
                    WHEN "${idsToExclude}" = "0" THEN TRUE 
                    ELSE id NOT IN (${idsToExclude}) 
                END) `;

            const excludeIdsWhere = (idsToExclude) => { 
                return `AND (CASE
                    WHEN "${idsToExclude}" = "0" THEN TRUE 
                    ELSE id NOT IN (${idsToExclude}) 
                END) `;
            }

            const pWhere = `AND ${priority} > 0 `;

            const dedupeWhere = `AND CASE
                WHEN "${questionsWithinInterval}" IS NULL OR "${questionsWithinInterval}" = "" THEN TRUE 
                ELSE id NOT IN (${questionsWithinInterval}) 
            END `;

            let catWhere = '';
            if ((typeof categoryId === 'string' && categoryId.includes(",")) || categoryId > 0) {
                catWhere = `AND FIND_IN_SET(category_id, ${categoryId}) > 0 `;
            }

            const nonCatWhere = `AND FIND_IN_SET(category_id, ${categoryId}) = 0 `;

            const priorityWhere = `AND (CASE 
                WHEN '${dataType}' IN ('ret-openers', 'ret-clickers') THEN FIELD(calculated_priority, ${fieldOrder}) >= FIELD(${priority}, ${fieldOrder})
                ELSE calculated_priority >= ${priority}
            END) `;

            const orderBy = `ORDER BY
                CASE
                    WHEN '${dataType}' IN ('ret-openers', 'ret-clickers') THEN FIELD(calculated_priority, ${fieldOrder})
                    ELSE calculated_priority
                END ASC,
                RAND()
            LIMIT ? `;

            let selectionCase;
            let selectionQuestionsArr = [];
            // Condition-1
            if (isPreferredRun === 1) {
                selectionCase = selCase || 0;
                let selectionQuestionsArr1 = [];

                if (isSamePriorityLevel) {
                    // All preferred categories OR Other categories, with same priority
                    selectionQuery = `${baseQuery}${catWhere}${dedupeWhere}${pWhere}${priorityWhere}${orderBy}`;                
                    selectionQuestionsArr = await this.executeQuery(selectionQuery, [qLimit]);
                    
                } else if (!isSamePriorityLevel && shouldDedupe) {
                    // All preferred cats OR Other categories, with other priority
                    selectionQuery = `${baseQuery}${catWhere}${dedupeWhere}ORDER BY RAND() LIMIT ?`;
                    selectionQuestionsArr1 = await this.executeQuery(selectionQuery, [qLimit]);
                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr1) : selectionQuestionsArr1;

                } else if (!isSamePriorityLevel && !shouldDedupe) {
                    // Remove deduped questions from selectedQuestions i.e. Random questions
                    selectionQuery = `${baseQuery}ORDER BY RAND() LIMIT ?`;
                    selectionQuestionsArr1 = await this.executeQuery(selectionQuery, [qLimit]);
                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr1) : selectionQuestionsArr1;
                }
            } 
            // Condition-2
            else if (
                counts.categoryQuestionCountDedup > 0 && counts.categoryQuestionCountDedup >= qLimit && selectedQuestions.length < counts.categoryQuestionCountDedup
            ) {
                selectionCase = 1;
                
                // Pull questions from the category, DEDUPED
                selectionQuery = `${baseQuery}${catWhere}${dedupeWhere}${pWhere}${priorityWhere}${orderBy}`;
                                
                selectionQuestionsArr = await this.executeQuery(selectionQuery, [qLimit]);
            }
            // Condition-3
            else if (
                (counts.categoryQuestionCountDedup > 0 && counts.categoryQuestionCountDedup < qLimit &&  counts.nonCategoryQuestionCountDedup > 0) 
                || (counts.categoryQuestionCountDedup > 0 && counts.categoryQuestionCountDedup < qLimit && counts.nonCategoryQuestionCountDedup === 0 && counts.categoryQuestionCountDedupNoPriority > 0)
                || (counts.categoryQuestionCountDedup > 0 && counts.categoryQuestionCountDedup < qLimit && counts.nonCategoryQuestionCountDedup === 0 && counts.categoryQuestionCountDedupNoPriority === 0 && counts.nonCategoryQuestionCountDedupNoPriority > 0)
            ) {
                selectionCase = 2;
                // Pull the category or non-category or no Difference or no priority queries over here if categoryQuestionCountDedup is less than queryLimit

                // Query-1
                selectionQuery = `${baseQuery}${catWhere}${pWhere}${dedupeWhere}${priorityWhere}${orderBy}`;
                let selectionQuestionsArr1 = await this.executeQuery(selectionQuery, [counts.categoryQuestionCountDedup]);
                let limitDiff = qLimit - counts.categoryQuestionCountDedup;

                idsToExclude = this.commaSeparationQuestionsConversion(selectionQuestionsArr1);

                // Query-2  
                selectionQuery = `${baseQuery}${excludeIdsWhere(idsToExclude)}${nonCatWhere}${dedupeWhere}${pWhere}${priorityWhere}${orderBy}`;
                let selectionQuestionsArr2 = await this.executeQuery(selectionQuery, [limitDiff]);

                selectionQuestionsArr = (selectionQuestionsArr1.length > 0) ? selectionQuestionsArr1.concat(selectionQuestionsArr2) : selectionQuestionsArr2;

                idsToExclude = this.commaSeparationQuestionsConversion(selectionQuestionsArr2);

                limitDiff = qLimit - counts.categoryQuestionCountDedup - counts.nonCategoryQuestionCountDedup;
                let selectionQuestionsArr3 = [];
                
                // Query-3
                if (limitDiff > 0) {
                    selectionCase = 2.1;
                    
                    selectionQuery = `${baseQuery}${excludeIdsWhere(idsToExclude)}${catWhere}${dedupeWhere}${pWhere}${priorityWhere}${orderBy}`;
                    selectionQuestionsArr3 = await this.executeQuery(selectionQuery, [limitDiff]);

                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr3) : selectionQuestionsArr3;
                }

                idsToExclude = this.commaSeparationQuestionsConversion(selectionQuestionsArr);

                limitDiff = qLimit - counts.categoryQuestionCountDedup - counts.nonCategoryQuestionCountDedup - counts.categoryQuestionCountDedupNoPriority;

                if ((limitDiff <= 0 && selectionQuestionsArr.length < qLimit) || (limitDiff != qLimit - selectionQuestionsArr.length)) limitDiff = qLimit - selectionQuestionsArr.length;

                // Query-6
                if (limitDiff > 0) {
                    selectionCase = 2.2;

                    selectionQuery = `${baseQuery}${excludeIdsWhere(idsToExclude)}${nonCatWhere}${dedupeWhere}ORDER BY RAND() LIMIT ?`;
                    selectionQuestionsArr3 = await this.executeQuery(selectionQuery, [limitDiff]);

                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr3) : selectionQuestionsArr3;
                }

                idsToExclude = this.commaSeparationQuestionsConversion(selectionQuestionsArr);

                limitDiff = qLimit - counts.categoryQuestionCountDedup - counts.nonCategoryQuestionCountDedup - counts.categoryQuestionCountDedupNoPriority - counts.nonCategoryQuestionCountDedupNoPriority;

                if ((limitDiff <= 0 && selectionQuestionsArr.length < qLimit) || (limitDiff != qLimit - selectionQuestionsArr.length)) limitDiff = qLimit - selectionQuestionsArr.length;

                // Query-7
                if (limitDiff > 0) {
                    selectionCase = 2.3;

                    selectionQuery = `${baseQuery}${excludeIdsWhere(idsToExclude)}ORDER BY RAND() LIMIT ?`;
                    selectionQuestionsArr3 = await this.executeQuery(selectionQuery, [limitDiff]);

                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr3) : selectionQuestionsArr3;
                }
            }  // Condition-4
            else if (
                (counts.nonCategoryQuestionCountDedup > 0 && counts.categoryQuestionCountDedup === 0) 
                || (counts.categoryQuestionCountDedup === 0 && counts.nonCategoryQuestionCountDedup === 0 && counts.categoryQuestionCountDedupNoPriority > 0)
                || (counts.categoryQuestionCountDedup === 0 && counts.nonCategoryQuestionCountDedup === 0 && counts.categoryQuestionCountDedupNoPriority === 0 && counts.nonCategoryQuestionCountDedupNoPriority > 0)
            ) {
                // Query-1
                selectionCase = 3;

                selectionQuery = `${baseQuery}${nonCatWhere}${dedupeWhere}${pWhere}${priorityWhere}${orderBy}`;
                selectionQuestionsArr = await this.executeQuery(selectionQuery, [qLimit]);

                idsToExclude = this.commaSeparationQuestionsConversion(selectionQuestionsArr);

                let limitDiff = qLimit - counts.nonCategoryQuestionCountDedup;
                let selectionQuestionsArr1 = [];

                // Query-2
                if (limitDiff > 0) {
                    selectionCase = 3.1;

                    selectionQuery = `${baseQuery}${excludeIdsWhere(idsToExclude)}${catWhere}${dedupeWhere}${pWhere}${priorityWhere}${orderBy}`;                
                    selectionQuestionsArr1 = await this.executeQuery(selectionQuery, [limitDiff]);

                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr1) : selectionQuestionsArr1;
                }

                idsToExclude = this.commaSeparationQuestionsConversion(selectionQuestionsArr);

                limitDiff = qLimit - counts.nonCategoryQuestionCountDedup - counts.categoryQuestionCountDedupNoPriority;

                if ((limitDiff <= 0 && selectionQuestionsArr.length < qLimit) || (limitDiff != qLimit - selectionQuestionsArr.length)) limitDiff = qLimit - selectionQuestionsArr.length;

                // Query-5
                if (limitDiff > 0) {
                    selectionCase = 3.2;

                    selectionQuery = `${baseQuery}${excludeIdsWhere(idsToExclude)}${nonCatWhere}${dedupeWhere}ORDER BY RAND() LIMIT ?`;                
                    selectionQuestionsArr1 = await this.executeQuery(selectionQuery, [limitDiff]);

                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr1) : selectionQuestionsArr1;
                }

                idsToExclude = this.commaSeparationQuestionsConversion(selectionQuestionsArr);

                limitDiff = qLimit - counts.nonCategoryQuestionCountDedup - counts.categoryQuestionCountDedupNoPriority - counts.nonCategoryQuestionCountDedupNoPriority;

                if ((limitDiff <= 0 && selectionQuestionsArr.length < qLimit) || (limitDiff != qLimit - selectionQuestionsArr.length)) limitDiff = qLimit - selectionQuestionsArr.length;
                
                // Query-6
                if (limitDiff > 0) {
                    selectionCase = 3.3;

                    selectionQuery = `${baseQuery}${excludeIdsWhere(idsToExclude)}ORDER BY RAND() LIMIT ?`;                
                    selectionQuestionsArr1 = await this.executeQuery(selectionQuery, [limitDiff]);

                    selectionQuestionsArr = (selectionQuestionsArr.length > 0) ? selectionQuestionsArr.concat(selectionQuestionsArr1) : selectionQuestionsArr1;
                }
            } else {
                selectionCase = 4;

                // If no questions, just pull some random questions
                selectionQuery = `${baseQuery}ORDER BY RAND() LIMIT ?`;
                selectionQuestionsArr = await this.executeQuery(selectionQuery, [qLimit]);
            }

            // Adjust selectionCase in selectionQuestionsArr
            if (selectionQuestionsArr.length > 0) {
                selectionQuestionsArr = selectionQuestionsArr.map(row => {
                    return {
                        ...row,
                        dataType: dataType,
                        selectionCase: selectionCase
                    }
                });
            }

            console.log('selectionQuestionsArr.length', selectionQuestionsArr.length);
            
            if (selectionQuestionsArr.length < qLimit) addTemplate = 0;

            let template = null;
            if (addTemplate) {
                // Fetch template using the template ID and selection case
                template = this.queryResultsCache.templateData;
                template.dataType = dataType;
                template.selectionCase = selectionCase;

                // If template data is not cached, fetch it from the database
                if (!this.useCache) template = await this.getDataFromTable('templates', selectionCase, dataType);
            }

            if (template) {
                selectionQuestionsArr.push(template);
            }

            return selectionQuestionsArr;
        } catch (error) {
            console.error('Error getting question selection logic:', error);
            return false;
        }
    }

    // Helper function to convert selected questions to comma separated string
    commaSeparationQuestionsConversion(selectedarticlesArray) {
        // Extract question IDs from selectedQuestions which are already selected in selection logic will not be repeat 
        let idsToExclude = 0;
        if (selectedarticlesArray.length > 0) {
            idsToExclude = selectedarticlesArray.map(question => `'${question.blog_id}'`).join(', ');
        }

        return idsToExclude;
    }

    /**
     * Executes a SQL query with parameters using a connection from the pool and returns the results.
     * @param {string} query - The SQL query to execute.
     * @param {Array} [params=[]] - The parameters for the SQL query.
     * @returns {Promise<Array>} - The results of the query.
     */
    async executeQuery(query, params = []) {
        try {
            // Use the shared pool and wrap in a Promise for async/await style
            const [results] = await pool.query(query, params);

            this.queryRunCount++; // Increment the query run count
            
            if (query.includes('CREATE')) console.log(`${this.tempTable} Table Created and Data Inserted Successfully!`);
            if (query.includes('DROP')) console.log(`${this.tempTable} Table Dropped Successfully!`);
            
            return results;
        } catch (error) {
            console.error('Error executing query:', error);
            return this.generateErrorResponse(`Error executing query: ${error.message}`);
        }
    }

    // Helper function to get questions based on parameters
    async getQuestions(categoryId, qLimit, priority, isPreferredRun, addTemplate, iterator, dataType, questionsWithinInterval, selectedQuestions, isSamePriorityLevel = false, selectionCase = 0, shouldDedupe = true) {
        // Validate inputs before proceeding
        priority = Number(priority);

        // Ensure questionsWithinInterval is in the correct format
        if (typeof questionsWithinInterval === 'string') {
            questionsWithinInterval = questionsWithinInterval.split(',').map(id => `'${id.trim()}'`).join(', ');
        }

        return await this.getQuestionsFromSelectionLogic(
            categoryId, qLimit, priority, addTemplate, iterator, isPreferredRun, dataType, questionsWithinInterval, selectedQuestions, isSamePriorityLevel, selectionCase, shouldDedupe
        );
    }

    /**
     * Get active headlines for a blog post
     * @param {string} blogId - The blog ID to get headlines for
     * @returns {Promise<Array>} - Array of active headlines ordered by headline_index
     */
    async getActiveHeadlines(blogId) {
        try {
            const sql = `
                SELECT headline, headline_index 
                FROM NewsEngine.blog_headlines 
                WHERE blog_id = ? 
                AND is_active = 1 
                ORDER BY headline_index ASC
            `;
            
            const results = await this.executeQuery(sql, [blogId]);
            return results || [];
        } catch (error) {
            console.error('Error fetching headlines for blog_id:', blogId, error);
            return [];
        }
    }

    /**
     * Get the next headline to serve based on last_served rotation
     * Returns the headline with the oldest last_served timestamp (NULL first)
     * and updates its last_served timestamp and increments serve_count
     */
    async getNextHeadlineToServe(blogId) {
        try {
            // Get headline with oldest last_served (NULL first for never-served headlines)
            const selectSql = `
                SELECT headline, headline_index, last_served
                FROM NewsEngine.blog_headlines 
                WHERE blog_id = ? AND is_active = 1 
                ORDER BY last_served IS NULL DESC, last_served ASC
                LIMIT 1
            `;
            
            const results = await this.executeQuery(selectSql, [blogId]);
            
            if (results && results.length > 0) {
                const selectedHeadline = results[0];
                
                // Update last_served timestamp
                const updateSql = `
                    UPDATE NewsEngine.blog_headlines 
                    SET last_served = NOW()
                    WHERE blog_id = ? AND headline_index = ?
                `;
                const updateResult = await this.executeQuery(updateSql, [blogId, selectedHeadline.headline_index]);
                
                // Check if UPDATE actually worked
                if (updateResult && updateResult.affectedRows === 0) {
                    console.error(`[HEADLINE_ROTATION] UPDATE failed - no rows affected for blog_id=${blogId}, headline_index=${selectedHeadline.headline_index}`);
                } else if (updateResult && updateResult.status === false) {
                    console.error(`[HEADLINE_ROTATION] UPDATE error for blog_id=${blogId}:`, updateResult.message);
                }
                
                return selectedHeadline;
            }
            
            return null;
        } catch (error) {
            console.error('Error getting next headline for blog_id:', blogId, error);
            return null;
        }
    }
}

module.exports = NewsLogic;