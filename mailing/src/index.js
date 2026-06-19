const crypto = require('crypto');
const https = require('https');
const http = require('http');
const MD5 = require('md5');
const { parse } = require('node-html-parser');
const NewsLogic = require('./NewsLogic');

// HARDCODED PRODUCTION DEDUP LAMBDA URL
// const PRODUCTION_DEDUP_URL = 'https://uyyyxdctmzvh3mh5onghepym6i0xjcwb.lambda-url.us-west-2.on.aws/';
const PRODUCTION_DEDUP_URL = 'https://3by3j4fknkjyvuhih47dpydlwe0xtstt.lambda-url.us-west-2.on.aws/';
// TO USE IMAGES SIZE WITH EXTENSION AS PER REQUIREMENT
const IMAGE_SIZE = '_600x450.webp';


/**
 * Extract query string parameters from the event object
 * @param event
 * @param param
 * @param defaultValue
 * @returns {*|string}
 * @constructor
 */
function ExtractQSParam(event, param, defaultValue = ''){
    return ('queryStringParameters' in event && param in event.queryStringParameters && event.queryStringParameters[param].length > 0) ? event.queryStringParameters[param] : defaultValue;

}


/**
 * Extract query string int from the event object
 * @param event
 * @param param
 * @param defaultValue
 * @returns {number|number}
 * @constructor
 */
function ExtractQSInt(event, param, defaultValue = -1){
    return ('queryStringParameters' in event && param in event.queryStringParameters) ? parseInt(event.queryStringParameters[param]) : defaultValue;
}


function shuffle(array) {
    let currentIndex = array.length,  randomIndex;

    // While there remain elements to shuffle.
    while (currentIndex > 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }

    return array;
}


/**
 * Get headline rotation position from dedup service (PRODUCTION VERSION)
 * @param blogId
 * @param totalHeadlines
 * @param project
 * @returns {Promise<unknown>}
 * @constructor
 */
const DedupServiceGet = async (dedupedProject, email, dedupedPeriod, multiDedupProjectList) => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;
    const TIMEOUT_MS = 8000;

    const singleAttempt = () => new Promise((resolve, reject) => {
        // ALWAYS use production Lambda URL
        let url = `${PRODUCTION_DEDUP_URL}?o_dedupedProject=${dedupedProject}&o_email=${email}&o_dedupedPeriod=${dedupedPeriod}&useCase=get&responseGrouping=byDate`;
        if (multiDedupProjectList) {
            url += `&o_multiDedupProjectList=${multiDedupProjectList}`;
        }
        const req = https.get(url, res => {
            res.setEncoding('utf8');
            let body = '';
            res.on('data', chunk => body += chunk);

            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let parsedBody = '';
                    try {
                        if (body && body.length > 0) {
                            if (typeof body === 'string') {
                                parsedBody = JSON.parse(body);
                            } else {
                                parsedBody = body;
                            }
                        } else {
                            parsedBody = 'No body returned';
                        }
                    } catch (e) {
                        parsedBody = body || 'No body returned';
                    }
                    console.error('DedupServiceGet error - statusCode:', res.statusCode, 'body:', parsedBody);
                    return reject(new Error('BadDedupRequest.statusCode=' + res.statusCode));
                }
                resolve(body);
            });
        });

        // Abort if DedupService takes longer than TIMEOUT_MS
        req.setTimeout(TIMEOUT_MS, () => {
            req.destroy(new Error(`DedupServiceGet timeout after ${TIMEOUT_MS}ms`));
        });

        req.on('error', reject);
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await singleAttempt();
        } catch (err) {
            const is429 = err.message && err.message.includes('statusCode=429');
            if (is429 && attempt < MAX_RETRIES) {
                const delayMs = Math.random() * BASE_DELAY_MS * Math.pow(2, attempt - 1); // jitter: 0–1s, 0–2s
                console.warn(`[DedupService] 429 CallerRateLimitExceeded — attempt ${attempt}/${MAX_RETRIES}, retrying in ${delayMs}ms`);
                await new Promise(res => setTimeout(res, delayMs));
            } else {
                throw err;
            }
        }
    }
};


/**
 * Send the request to the dedup service to log the question ids used and the request (PRODUCTION VERSION)
 * @param dedupedProject
 * @param email
 * @param dedupedPeriod - int
 * @param templateId - int
 * @param ip
 * @param reqPath
 * @param reqDetails
 * @param $success - 1 / 0
 * @param usedQuestionIds - only comma seperated
 * @param headlineIndices - comma-separated headline rotation indices for all brands articles
 * @param blogsDataTypeString - comma-separated data_type for all brands articles
 * @returns {Promise<unknown>}
 * @constructor
 */
const DedupServiceLog = async (dedupedProject, email, dedupedPeriod, templateId, ip, reqPath, reqDetails, success, usedQuestionIds, event, headlineIndices = null, blogsDataTypeString = '', ispValue = '') => {
    
    // dynamically add params so the log gets them IF they will not clash with dedup service params.
    let reservedParamNames = ['dedupedProject', 'email', 'dedupedPeriod', 'templateId', 'ip', 'reqPath', 'reqDetails', 'success', 'usedQuestionIds', 'json_config', 'headline_index', 'data_type'];
    let addonTemplate = '';
    
    for (let [key, value] of Object.entries(event.queryStringParameters)) {
      if (reservedParamNames.indexOf(key) > -1) continue;
      value = encodeURIComponent(value);
      addonTemplate = addonTemplate + `&${key}=${value}`;
    }
    
    // Add headline_index (comma-separated for all brands articles)
    if (headlineIndices !== null) {
        addonTemplate = addonTemplate + `&headline_index=${headlineIndices}`;
    }

    // Add data_type (comma-separated for all brands articles)
    if (blogsDataTypeString !== '') {
        addonTemplate = addonTemplate + `&data_type=${blogsDataTypeString}`;
    }

    // Add isp param for news_command project if ispValue is provided and not empty
    if (dedupedProject === 'news_command' && ispValue !== '') {
        addonTemplate = addonTemplate + `&isp=${ispValue}`;
    }
    
    return new Promise((resolve, reject) => {
        // ALWAYS use production Lambda URL
        let url = `${PRODUCTION_DEDUP_URL}?l_templateId=${templateId}&l_ip=${ip}&l_requestPath=${reqPath}&l_reqDetails=${reqDetails}&l_success=${success}&l_dedupedProject=${dedupedProject}&l_dedupedPeriod=${dedupedPeriod}&l_usedQuestions=${usedQuestionIds}&useCase=log&l_email=${email}${addonTemplate}`;
        console.log(url);
        
        // Production Lambda URLs are always HTTPS
        https.get(url, res => {
            res.setEncoding('utf8');
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(body));
        }).on('error', reject);
    });
};


/**
 * Call Boardwalk API to get dynamic ad HTML for the given positions.
 * Returns the raw response body (HTML or JSON) on success, or rejects on failure/timeout.
 * @param {string} email
 * @param {string} hcmpid
 * @param {string} mailing_id
 * @param {string} list_id
 * @param {number[]} positions
 * @param {string} c1
 * @param {string} c2
 * @param {string} c3
 * @param {string} template_slug
 * @returns {Promise<string>}
 */
const BoardwalkAdsGet = async (email, hcmpid, mailing_id, list_id, positions, c1, c2, c3, data_type, brand, domain, template_slug) => {
    return new Promise((resolve, reject) => {
        const md5_email = MD5(email);
        const payload = JSON.stringify({
            template_slug,
            campaign:    { hcmpid: parseInt(hcmpid) || 0, mailing_id, list_id},
            recipient:   { email, md5_email },
            slots:       { positions },
            attribution: { c1, c2, c3, data_type, brand, domain }
        });

        const apiKey = process.env.BOARDWALK_API_KEY || '';
        const options = {
            hostname: 'next.boardwalk.marketing',
            path: '/api/bwie/decisions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error('BoardwalkAdsGet.statusCode=' + res.statusCode));
            }
            res.setEncoding('utf8');
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(body));
        });

        // Abort and fall back to template ads if Boardwalk is slow
        req.setTimeout(4000, () => req.destroy(new Error('BoardwalkAdsGet timeout')));
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
};


/**
 * Extract a single HTML string from the Boardwalk API response.
 * Handles both raw HTML and common JSON envelope shapes.
 * Adjust this function if the actual API response structure differs.
 * @param {string} responseBody
 * @returns {string}
 */
function parseBoardwalkResponse(responseBody) {
    try {
        const json = JSON.parse(responseBody);
        // Array of decision objects: [{position, html}, ...]
        if (Array.isArray(json)) return json.map(d => d.html || '').join('');
        // {decisions: [{position, html}, ...]}
        if (json.decisions && Array.isArray(json.decisions)) return json.decisions.map(d => d.html || '').join('');
        // {html: "..."} or {content: "..."}
        if (typeof json.html === 'string') return json.html;
        if (typeof json.content === 'string') return json.content;
        // Map of position → html: {"1": "<tr>...</tr>", ...}
        return Object.values(json).filter(v => typeof v === 'string').join('');
    } catch {
        // Not JSON — treat the whole body as raw HTML
        return responseBody;
    }
}


const CATEGORY_COLOR_MAP = {
    'America Now':  '#245bbe',
    'Daily Sparks': '#7e238f',
    'Better Living':'#e8693f',
    'Everyday Life':'#1f2f5c',
};

/**
 * Format the job HTML based on the API response
 * @param jobs_json
 * @param html
 * @returns {*}
 * @constructor
 */
async function FormatJobHTML(results, event) {
    let output = {
        success: true,
        functionName: 'FormatJobHTML',
        message: '',
        payload: [],
        question_array: []
    };

    try {
        // Validate if results is defined and is an array
        if (!Array.isArray(results) || results.length === 0) {
            console.error('Invalid results array:', results);
            output.success = false;
            output.payload = 'No results found to process';
            return output;
        }

        // Extract and parse the json_config parameter from the event
        let json_config = ExtractQSParam(event, 'json_config', '[]');
        const decodedJsonConfig = decodeURIComponent(json_config);
        const jsonArray = JSON.parse(decodedJsonConfig);
        let count = jsonArray.length;
        let templateIndex = results.length - 1;

        // Check if the template is present at the end of the results array
        if (!('template' in results[templateIndex])) {
            // Return a 404 error response if template is missing
            output.success = false;
            output.message = 'Template not found in Lambda response';
            output.payload = [];
            output.statusCode = 404;
            return output;
        }

        let template_html = results[templateIndex]['template'];
        
        let selection_case = ('selectionCase' in results[templateIndex]) ? results[templateIndex]['selectionCase'] : '000';
        // console.log('selection_case', selection_case);

        // Extract ad tables (q_offset_n) using HTML parser [node-html-parser]
        const root = parse(template_html, { blockTextElements: { script: true, style: true } });
        const adTableMap = new Map();

        root.querySelectorAll('div, tr').forEach(table => {
            const cls = table.getAttribute('class') || '';
            const match = cls.match(/\bq_offset_(\d+)\b/);
            if (match) {
                const index = parseInt(match[1], 10);
                adTableMap.set(index, table.outerHTML);
                table.remove(); // remove ad from template
            }
        });

        template_html = root.toString();
        // End of ad extraction
        // Override adTableMap with Boardwalk dynamic ads when available.
        // Falls back to the template's hardcoded q_offset_X rows if Boardwalk failed or was not requested.
        if (event['boardwalkAdsHtml']) {
            try {
                const bwHtml = parseBoardwalkResponse(event['boardwalkAdsHtml']);
                const bwRoot = parse(bwHtml, { blockTextElements: { script: true, style: true } });
                bwRoot.querySelectorAll('tr').forEach(tr => {
                    const cls = tr.getAttribute('class') || '';
                    const match = cls.match(/\bq_offset_(\d+)\b/);
                    if (match) adTableMap.set(parseInt(match[1], 10), tr.outerHTML);
                });
                console.log(`[Boardwalk] checkpoint 3 — adTableMap populated | size: ${adTableMap.size} | positions: [${[...adTableMap.keys()].join(', ')}]`);
            } catch (err) {
                console.warn(`[Boardwalk] checkpoint 3 — Failed to parse Boardwalk ads HTML: ${err.message}`);
            }
        } else {
            console.log(`[Boardwalk] checkpoint 3 — boardwalkAdsHtml is null/empty, no ads to inject`);
        }
        // single question node!! - question template
        let trivia_template = template_html.substring(
            template_html.indexOf("<question>"),
            template_html.lastIndexOf("</question>") + 11
        );

        // create housing html for trivia questions with the replacement component inside.
        let sliced_html = template_html.split('<question>')[0] + '{trivia_template}' + template_html.split('</question>')[1];
        output['slicedHtml'] = sliced_html;

        // Feature section implementation STARTS HERE
        // Count actual articles to insert (exclude template row which has null blog_id)
        const articleCount = results.filter(r => r.blog_id && r.blog_id !== null && r.blog_id !== 'null').length;

        // Parse <question> inner content to detect single vs. featured/regular split
        const questionInner = template_html.substring(
            template_html.indexOf("<question>") + 10,
            template_html.lastIndexOf("</question>")
        );
        const questionParsed = parse(questionInner, { blockTextElements: { script: true, style: true } });
        const templateElements = questionParsed.childNodes.filter(node => {
            const tag = node.rawTagName;
            return tag === 'tr' || tag === 'div';
        });

        let featured_template = trivia_template;
        let regular_template  = trivia_template;

        if (templateElements.length === 1) {
            const cls = templateElements[0].getAttribute('class') || '';
            if (cls.includes('featured_content') && articleCount > 1) {
                output.success = false;
                output.message = 'Invalid html: single featured_content template cannot be used with more than 1 article';
                return output;
            }
            // single element, no featured_content — existing behaviour, both vars stay === trivia_template

        } else if (templateElements.length === 2) {
            const featuredEls = templateElements.filter(el => (el.getAttribute('class') || '').includes('featured_content'));

            if (featuredEls.length === 0) {
                output.success = false;
                output.message = 'Invalid html: 2 template elements found but neither has class="featured_content"';
                return output;
            }
            if (featuredEls.length === 2) {
                output.success = false;
                output.message = 'Invalid html: both template elements have class="featured_content"';
                return output;
            }

            // Exactly 1 featured — set up split templates
            const featuredEl = templateElements.find(el =>  (el.getAttribute('class') || '').includes('featured_content'));
            const regularEl  = templateElements.find(el => !(el.getAttribute('class') || '').includes('featured_content'));
            featured_template = '<question>' + featuredEl.outerHTML + '</question>';
            regular_template  = '<question>' + regularEl.outerHTML  + '</question>';
            // articleCount === 1: regular_template is declared but never reached (loop exits after qc === 1)

        } else if (templateElements.length > 2) {
            output.success = false;
            output.message = 'Invalid html: more than 2 template elements found within <question> tags';
            return output;
        }
        // templateElements.length === 0: no <tr>/<div> found — trivia_template used as-is, existing behaviour
        // Feature section implementation ENDS HERE

        // Get image positions from query parameter (e.g., "1,4,5,8,9")
        let imagePositions = ExtractQSParam(event, 'image_positions', '');
        const allowedImagePositions = imagePositions 
            ? new Set(imagePositions.split(',').map(n => parseInt(n.trim(), 10))) 
            : null; // null means show all images (default behavior)

        let remove_question_tags = ExtractQSParam(event, 'remove_question_tags', "false");
        // translates a string into boolean
        remove_question_tags = (remove_question_tags == "true");

        let hpurl = ExtractQSParam(event, 'hpurl');
        let hpversion = ExtractQSParam(event, 'hpversion'); // 1 or 2
        let earlyQuestionMark = '';
        let lateQuestionMark = '';

        if(hpversion == '2'){
            earlyQuestionMark = '';
            lateQuestionMark = '?';
        } else{
            earlyQuestionMark = '?';
            lateQuestionMark = '';
        }

        let c1 = ExtractQSParam(event, 'c1');
        let c2 = ExtractQSParam(event, 'c2');
        let c3 = ExtractQSParam(event, 'c3');
        let email = ExtractQSParam(event, 'email', '');

        let hash = ExtractQSParam(event, 'md5', '');

        let mailing_id = ExtractQSParam(event, 'mailingID', '');

        /* Check the hd_cid_names array params value one by one and pass the value to hpurl if one of these parameters has a value */
        let hd_cid_names = [
            'hcid',
            'hpcid',
            'hcmpid',
            'hcmp',
            'hcampaignid',
            'orig_hpcid',
            'o_cid',
            'cid'
        ];

        let lpid = ExtractQSParam(event, 'lpid', '');
        let ispValue = ExtractQSParam(event, 'isp', '');

        // Find the first available CID param name and value
        let cid_param = null;
        let cid_value = null;

        for (const name of hd_cid_names) {
            const value = ExtractQSParam(event, name);
            if (value) {
                cid_param = name;
                cid_value = value;
                break;
            }
        }

        // Add cid_param and cid_value param if exists
        if (cid_param && cid_value) {
            hpurl = hpurl + earlyQuestionMark + '/' + c1 + '/' + c2 + '/' + c3 + lateQuestionMark + `email=${email}&md5=${hash}&mailingID=${mailing_id}&${cid_param}=${cid_value}&lpid=${lpid}&isp=${ispValue}`;
        } else {
            hpurl = hpurl + earlyQuestionMark + '/' + c1 + '/' + c2 + '/' + c3 + lateQuestionMark + `email=${email}&md5=${hash}&mailingID=${mailing_id}&lpid=${lpid}&isp=${ispValue}`;
        }

        // TODO: WE NEED TO account for the questions, answers, other data, and template!!! all is coming from results param!
        let trivia_formatted_html = '';
        let questionIds = [];
        var qc = 0;
        let email_hash = crypto.createHash('md5').update(email).digest("hex");
        let firstArticleProcessed = false;
        let headlineIndices = []; // Track headline indices for ALL brands articles
        let heroHeadline = ''; // Track hero (first) headline text
        let dataTypeValue = ''; // Track dataType for replacement outside <question> tags
        let blogsDataType = []; // Track DataTypes for ALL brands articles logging
        let dedupServiceProject = ExtractQSParam(event, 'dedup_service_project');


        // Iterate through each question result to format HTML
        for (let q in results) {
            if (!results[q]['blog_id']) continue;
            qc++;
            
            // skip if its the template row.
            if('blog_id' in results[q] && (results[q]['blog_id'] === null  || results[q]['blog_id'] === 'null')) { continue; }

            // Initialize headline tracking for this article
            let currentHeadline = results[q]['title'] || '';
            // For non-hero articles (qc > 1), use hdline0 since we display headline 0 from blogs table
            let currentHeadlineIndex = (qc > 1) ? 'hdline0' : '';
            let articleHeadlineIndexNum = 0; // Default to 0 for non-hero articles

            // NEW: Handle headline rotation for first article
            if (!firstArticleProcessed && qc === 1) {
                firstArticleProcessed = true;
                
                try {
                    // Need to instantiate NewsLogic to get next headline to serve
                    // Get required parameters from event
                    let template_id = ExtractQSParam(event, 'template_id', '1');
                    let ip = ExtractQSParam(event, 'ip', '0.0.0.0');
                    let path = ('rawPath' in event) ? event.rawPath : '/';
                    let query_string = ('rawQueryString' in event && event.rawQueryString.length >= 13) ? event.rawQueryString : '';
                    let json_config = ExtractQSParam(event, 'json_config', '[]');
                    let forbiddenQJson = '[]'; // Not needed for this call
                    
                    const newsLogic = new NewsLogic(template_id, ip, path, query_string, email, json_config, forbiddenQJson, dedupServiceProject, [], ispValue);
                    
                    // Get next headline based on MySQL last_served rotation
                    const selectedHeadline = await newsLogic.getNextHeadlineToServe(results[q]['blog_id']);
                    
                    if (selectedHeadline) {
                        // Override the title with the rotated headline
                        results[q]['title'] = selectedHeadline.headline;
                        currentHeadline = selectedHeadline.headline;
                        currentHeadlineIndex = 'hdline' + selectedHeadline.headline_index;
                        
                        // Store headline_index number for tracking (not the string)
                        articleHeadlineIndexNum = selectedHeadline.headline_index;
                        
                        // Store hero headline (first article)
                        heroHeadline = selectedHeadline.headline;
                        
                        console.log(`Headline rotation (MySQL): blog_id=${results[q]['blog_id']}, headline_index=${selectedHeadline.headline_index}, headline="${selectedHeadline.headline}"`);
                    }
                    // If no headlines found, keep original title from results
                } catch (error) {
                    console.error('Headline rotation failed, using original title:', error.message);
                    console.error('Full error:', error);
                    // Keep original title, continue processing
                }
            }
            
            // Track headline index for this article (for all articles, not just hero)
            headlineIndices.push(articleHeadlineIndexNum);

            if (qc === 1) {
                dataTypeValue = results[q]['dataType'] || '';
            }          

            questionIds.push(results[q]['blog_id']);

            // needs to get applied to each choice seperately (q_choice_link)
            let job_url = ExtractQSParam(event, 'job_url');

            if (dedupServiceProject == 'news_command') {
                job_url = ExtractQSParam(event, 'job_url', 'https://newscommand.com/article/');

                // Track and handle dataType for news_command
                blogsDataType.push(results[q]['dataType']);
            }

            if (dedupServiceProject == 'truth_facts') {
                job_url = ExtractQSParam(event, 'job_url', 'https://truthinfacts.com/article/');

                // Track and handle dataType for truth_facts
                blogsDataType.push(results[q]['dataType']);
            }

            if (dedupServiceProject == 'topline_news') {
                job_url = ExtractQSParam(event, 'job_url', 'https://toplinenews.com/article/');

                // Track and handle dataType for topline_news
                blogsDataType.push(results[q]['dataType']);
            }

            if (dedupServiceProject == 'news_beyond') {
                job_url = ExtractQSParam(event, 'job_url', 'https://newsandbeyond.com/article/');

                // Track and handle dataType for news_beyond
                blogsDataType.push(results[q]['dataType']);
            }

            if (dedupServiceProject == 'all_news') {
                job_url = ExtractQSParam(event, 'job_url', 'https://allthatnews.com/article/');

                // Track and handle dataType for all_news
                blogsDataType.push(results[q]['dataType']);
            }

            let redirect_template1 = hpurl + '&joburl=' + `${job_url}{article_slug}?article_id=${results[q]['blog_id']}&md5=${email_hash}&type=content`;

            // Format the question HTML
            // let current_trivia_html = ' ' + trivia_template;

            // Format the question HTML — use featured_template for article 1, regular_template for the rest.
            // When only 1 <tr>/<div> exists (single-template mode), both vars equal trivia_template so behaviour is unchanged.
            let current_trivia_html = ' ' + (qc === 1 ? featured_template : regular_template);
            let i = 0;
            for (let key in results[q]) {
                // Add article position macro (format: position1, position2, etc.)
                current_trivia_html = current_trivia_html.replaceAll(`{article_position}`, `position${qc}`);
                redirect_template1 = redirect_template1.replaceAll(`{article_position}`, `position${qc}`);
                if(key == 'slug') {
                    current_trivia_html = current_trivia_html.replaceAll(`{article_slug}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{article_slug}`, results[q][key]);
                } else if(key == 'title') {
                    current_trivia_html = current_trivia_html.replaceAll(`{article_title}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{article_title}`, results[q][key]);
                    // Add headline macros
                    current_trivia_html = current_trivia_html.replaceAll(`{article_headline}`, currentHeadline);
                    current_trivia_html = current_trivia_html.replaceAll(`{article_headline_index}`, currentHeadlineIndex);
                    current_trivia_html = current_trivia_html.replaceAll(`{hero_headline}`, heroHeadline);
                    redirect_template1 = redirect_template1.replaceAll(`{article_headline}`, currentHeadline);
                    redirect_template1 = redirect_template1.replaceAll(`{article_headline_index}`, currentHeadlineIndex);
                    redirect_template1 = redirect_template1.replaceAll(`{hero_headline}`, heroHeadline);
                } else if(key == 'author_name') {
                    current_trivia_html = current_trivia_html.replaceAll(`{article_author_name}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{article_author_name}`, results[q][key]);
                } else if(key == 'short_content') {
                    let shortContent = results[q][key] || '';
                    // Remove "Read More" and everything after it (including incomplete/malformed HTML)
                    shortContent = shortContent.replace(/\s*<[^>]*Read More.*$/i, '').trim();
                    shortContent = shortContent.replace(/\s*Read More.*$/i, '').trim();
                    // Remove only <a> tags but keep the text content inside them
                    shortContent = shortContent.replace(/<a[^>]*>/gi, '').replace(/<\/a>/gi, '');
                    current_trivia_html = current_trivia_html.replaceAll(`{article_short_content}`, shortContent);
                    redirect_template1 = redirect_template1.replaceAll(`{article_short_content}`, shortContent);
                } else if(key == 'category_name') {
                    current_trivia_html = current_trivia_html.replaceAll(`{article_category}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{article_category}`, results[q][key]);
                    const categoryColor = CATEGORY_COLOR_MAP[results[q][key]] || '';
                    current_trivia_html = current_trivia_html.replaceAll(`{article_category_color}`, categoryColor);
                    redirect_template1 = redirect_template1.replaceAll(`{article_category_color}`, categoryColor);

                } else if(key == 'category_id') {          
                    current_trivia_html = current_trivia_html.replaceAll(`{article_category_id}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{article_category_id}`, results[q][key]);

                } else if(key == 'blog_id') {
                    current_trivia_html = current_trivia_html.replaceAll(`{article_id}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{article_id}`, results[q][key]);
                } else if (key == 'fileName') {
                    // Check if this position should show images
                    const shouldShowImage = !allowedImagePositions || allowedImagePositions.has(qc);
                    
                    if (shouldShowImage) {
                        // Show image for this article position
                        if (results[q][key]) {
                            // Need to fetch smaller images size rather than original image directly
                            let newImg = results[q][key].split('.');
                            newImg = `${newImg[0]}${IMAGE_SIZE}`;

                            let imgBaseUrl = 'https://bfi.boldfact.com/';
                            if (dedupServiceProject == 'news_command') {
                                imgBaseUrl = 'https://nci.newscommand.com/';
                            } else if (dedupServiceProject == 'truth_facts') {
                                imgBaseUrl = 'https://tifi.truthinfacts.com/';
                            } else if (dedupServiceProject == 'topline_news') {
                                imgBaseUrl = 'https://tlni.toplinenews.com/';
                            } else if (dedupServiceProject == 'news_beyond') {
                                imgBaseUrl = 'https://nabi.newsandbeyond.com/';
                            } else if (dedupServiceProject == 'all_news') {
                                imgBaseUrl = 'https://atni.allthatnews.com/';
                            }
                            
                            current_trivia_html = current_trivia_html.replaceAll(`{article_image_url}`, `${imgBaseUrl}${newImg}`);
                            redirect_template1 = redirect_template1.replaceAll(`{article_image_url}`, `${imgBaseUrl}${newImg}`);
                        } else {
                            // No image file, just replace with empty string
                            current_trivia_html = current_trivia_html.replaceAll(`{article_image_url}`, '');
                            redirect_template1 = redirect_template1.replaceAll(`{article_image_url}`, '');
                        }
                    } else {
                        // This position should NOT show images - remove the entire img tag
                        // First try to remove the img tag with the placeholder
                        current_trivia_html = current_trivia_html.replace(/<img[^>]*\{article_image_url\}[^>]*>/gis, '');
                        // Also replace any remaining placeholder as fallback
                        current_trivia_html = current_trivia_html.replaceAll(`{article_image_url}`, '');
                        redirect_template1 = redirect_template1.replaceAll(`{article_image_url}`, '');
                    }
                } else if(key.includes('calculated_priority')) {
                    current_trivia_html = current_trivia_html.replaceAll(`{article_calc_priority}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{article_calc_priority}`, results[q][key]);
                } else if(key == 'selectionCase'){
                    current_trivia_html = current_trivia_html.replaceAll(`{${key}}`, selection_case);
                    redirect_template1 = redirect_template1.replaceAll(`{${key}}`, selection_case);
                } else if(key == 'dataType') {
                    current_trivia_html = current_trivia_html.replaceAll(`{${key}}`, results[q][key]);
                    redirect_template1 = redirect_template1.replaceAll(`{${key}}`, results[q][key]);
                }
            }
        
            // Replace the article click URL
            current_trivia_html = current_trivia_html.replaceAll(`{article_click_url}`, redirect_template1);

            // Remove question tags if requested// Remove question tags if requested
            if(remove_question_tags) { 
                current_trivia_html = current_trivia_html.replaceAll('<question>', '').replaceAll('</question>', '');
            }

            // Append the formatted question HTML to the final output
            trivia_formatted_html += current_trivia_html;
            
            // Append ad if q_offset_<qc> exists
            if (adTableMap.has(qc)) {
                let ad = adTableMap.get(qc);
                ad = ad.replaceAll('{dataType}', dataTypeValue);
                trivia_formatted_html += `${ad}`;
                console.log(`[Boardwalk] checkpoint 4 — ad injected at position ${qc}`);
            }
            output['question_array'].push(current_trivia_html);
        }
        
        // Replace {hero_headline} macro in sliced_html (outside of question tags)
        sliced_html = sliced_html.replaceAll('{hero_headline}', heroHeadline);

        // Replace {dataType} macro in sliced_html (outside of question tags)
        sliced_html = sliced_html.replaceAll('{dataType}', dataTypeValue);

        // Handle blogsDataType array for all brands
        let blogsDataTypeString = blogsDataType.every(v => v === blogsDataType[0])
                ? blogsDataType[0] // all values same → return single value
                : blogsDataType.join(','); // otherwise → join all
        
        // Dedup service log
        await DedupServiceLog(
            event['dedupServicetLog'].dedupServiceProject,
            event['dedupServicetLog'].email,
            event['dedupServicetLog'].wideLookback,
            event['dedupServicetLog'].template_id,
            event['dedupServicetLog'].ip,
            event['dedupServicetLog'].path,
            event['dedupServicetLog'].reqDetails,
            event['dedupServicetLog'].success,
            questionIds.join(','),
            event,
            headlineIndices.join(','),
            blogsDataTypeString,
            ispValue || ''
        );
        
        // Replace the trivia template with formatted questions in the HTML
        output.payload = sliced_html.replaceAll('{trivia_template}', trivia_formatted_html);
        ExtractQSParam(event, 'response_format') === 'json' ? output.hero_headline = heroHeadline : ''; // Include hero headline in output for json format
        return output;
    } catch (error) {
        output.success = false;
        output.message = error.message;
        return output;
    }
}

/**
 * Get the template from the db and log the request
 * @param template_id
 * @param ip
 * @param path
 * @param query_string
 * @returns {Promise<unknown>}
 * @constructor
 */
async function GetDBData(event){
    let output = {
        success: true,
        functionName: 'GetDBData',
        message: '',
        payload: []
    };
    
    try {
        let rawQS = ('rawQueryString' in event) ? event.rawQueryString : '';
        if (!rawQS || rawQS.length < 13) {
            output.success = false;
            output.message = 'Health check - no params provided';
            return output;
        }
        
        let ip = (('requestContext' in event) && ('http' in event.requestContext) && ('sourceIp' in event.requestContext.http)) ? event.requestContext.http['sourceIp'] : '0.0.0.0';
        ip = ExtractQSParam(event, 'ip', ip);
        // 13 is the min req for template_id=n
        let query_string = ('rawQueryString' in event && event.rawQueryString.length >= 13) ? event.rawQueryString : '';
        query_string = query_string.replaceAll("'", "");

        let template_id = ExtractQSParam(event, 'template_id', '1');
        let email = ExtractQSParam(event, 'email');
        // console.log('email:', email);
        
        // if email contains + sign and having a space then relpace it with + sign
        if (email.indexOf(' ') !== -1) email = email.replace(/ /g, '+');

        // Common regex for email validation
        const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
        if (!email || !emailRegex.test(email)) {
            // If email is invalid, throw an error
            throw new Error('Invalid email format');
        }

        let c1 = ExtractQSParam(event, 'c1', '');
        let c2 = ExtractQSParam(event, 'c2', '');
        let c3 = ExtractQSParam(event, 'c3', '');
        let narrowLookback = ExtractQSParam(event, 'narrowLookback', '7');
        let wideLookback = ExtractQSParam(event, 'wideLookback', '14');
        let json_config = ExtractQSParam(event, 'json_config', '[]');

        let static_articles = ExtractQSParam(event, 'static_articles');
        let articlesArray = ExtractQSParam(event, 'articlesArray', '[]');

        let path = ('rawPath' in event) ? event.rawPath : '/';
        let dedupServiceProject = ExtractQSParam(event, 'dedup_service_project');
        let isp = ExtractQSParam(event, 'isp', '');
        let multi_dedup_project_list = ExtractQSParam(event, 'multi_dedup_project_list', '');
        // Validate dedup_service_project variable
        // console.log('dedupServiceProject', dedupServiceProject);
        const dedupProjects = ['news_command', 'truth_facts', 'topline_news', 'news_beyond', 'all_news'];

        if (!dedupServiceProject || !dedupProjects.includes(dedupServiceProject)) throw new Error('Please check dedup_service_project variable.');

        ////////////////////////// deduper get //////////////////////////////////
        // get the widest lookback from json config
        let maxConfigLookback = 0
        let json_config_parsed = JSON.parse(json_config);
        
        for(let c in json_config_parsed){
            maxConfigLookback = (json_config_parsed[c]['lookBackInterval'] > maxConfigLookback) ? json_config_parsed[c]['lookBackInterval'] : maxConfigLookback;

            json_config_parsed[c]['dataType'] = json_config_parsed[c]['dataType'] || 'intro';
        }

        json_config = JSON.stringify(json_config_parsed); 

        // Build Boardwalk promise — controlled by bwad=true/false and bw_template_slug param.
        // Runs in parallel with DedupServiceGet so it adds no sequential latency.
        const isBoardwalkEnabled = ExtractQSParam(event, 'bwad', 'false');
        const boardwalkEnabled = (isBoardwalkEnabled || 'false').toLowerCase() === 'true';
        const bwTemplateSlug = ExtractQSParam(event, 'bw_template_slug', 'nc1');
        const shouldCallBoardwalk = boardwalkEnabled && bwTemplateSlug;
        console.log(`[Boardwalk] checkpoint 1 — BOARDWALK_ENABLED: ${boardwalkEnabled} | bw_template_slug: "${bwTemplateSlug}" | ${shouldCallBoardwalk ? 'API will be called' : 'SKIPPED'}`);

        // Resolve the effective campaign ID: use the first non-empty value from the known campaign param names.
        const campaignIdParams = ['hcmpid', 'orig_hpcid', 'hcid', 'hpcid', 'hcmp', 'hcampaignid', 'o_cid', 'cid'];
        let effectiveHcmpid = '';
        for (const param of campaignIdParams) {
            const val = ExtractQSParam(event, param);
            if (val) { effectiveHcmpid = val; break; }
        }
        console.log(`[Boardwalk] effectiveHcmpid value: ${effectiveHcmpid}`);

        let mailing_id = ExtractQSParam(event, 'mailing_id', '');

        // NOTE: For testing, I am using default parameters values. But these should be removed on Live server.
        const boardwalkPromise = shouldCallBoardwalk
            ? BoardwalkAdsGet(
                email,
                effectiveHcmpid || '9087',
                mailing_id || ExtractQSParam(event, 'mailingID', ''),
                ExtractQSParam(event, 'list_id', ''),
                ExtractQSParam(event, 'bw_positions', '1,2,3,4,5')
                    .split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p)),
                ExtractQSParam(event, 'c1', ''),
                ExtractQSParam(event, 'c2', ''),
                ExtractQSParam(event, 'c3', ''),
                ExtractQSParam(event, 'data_type', 'intro'),
                ExtractQSParam(event, 'brand', ''),
                ExtractQSParam(event, 'domain', ''),
                bwTemplateSlug
              )
            : Promise.resolve(null);

        // Fire both in parallel. Promise.allSettled ensures both always run to completion —
        // a failure in one never stops or discards the result of the other.
        const [dedupResult, boardwalkResult] = await Promise.allSettled([
            DedupServiceGet(dedupServiceProject, email, maxConfigLookback, multi_dedup_project_list),
            boardwalkPromise
        ]);

        // Handle Boardwalk result independently — failure silently skips ads
        if (boardwalkResult.status === 'rejected') {
            console.warn(`[Boardwalk] checkpoint 2 — BoardwalkAdsGet FAILED: ${boardwalkResult.reason.message}`);
        } else if (!shouldCallBoardwalk) {
            console.log(`[Boardwalk] checkpoint 2 — BoardwalkAdsGet SKIPPED (shouldCallBoardwalk=false)`);
        } else {
            const bwPreview = (boardwalkResult.value || '').substring(0, 300);
            console.log(`[Boardwalk] checkpoint 2 — BoardwalkAdsGet SUCCESS | response length: ${(boardwalkResult.value || '').length} | preview: ${bwPreview}`);
        }
        event['boardwalkAdsHtml'] = boardwalkResult.status === 'fulfilled' ? boardwalkResult.value : null;

        // Handle Dedup result — log error but continue with empty forbidden set so the Lambda does not crash.
        // console.error is intentional: keeps the error visible in CloudWatch to track occurrence frequency.
        let forbiddenQuestions;
        if (dedupResult.status === 'rejected') {
            console.error(`[DedupService] checkpoint 2 — DedupServiceGet FAILED after all retries: ${dedupResult.reason.message}`);
            forbiddenQuestions = {};
        } else {
            console.log(`[DedupService] checkpoint 2 — DedupServiceGet SUCCESS | response length: ${dedupResult.value.length} | forbidden date entries: ${Object.keys(JSON.parse(dedupResult.value)).length}`);
            forbiddenQuestions = JSON.parse(dedupResult.value);
        }

        let forbiddenQJson = [];
        
        for (let i in forbiddenQuestions) {
            for(let id in forbiddenQuestions[i][dedupServiceProject]){
                forbiddenQJson.push({"blog_id":forbiddenQuestions[i][dedupServiceProject][id],"activity_date":i});
            }
        }
        
        forbiddenQJson = forbiddenQJson.length > 0 ? JSON.stringify(forbiddenQJson) : forbiddenQJson;

        event['dedupServicetLog'] = {
            dedupServiceProject: dedupServiceProject,
            email: email,
            wideLookback: maxConfigLookback,
            template_id: template_id,
            ip: ip,
            path: path,
            reqDetails: 'none',
            success: (output.success ? 1 : 0),
            blog_ids: ''
        }
        
        ////////////////////////// deduper get //////////////////////////////////
        if(json_config != '[]') {
            json_config = decodeURIComponent(json_config);
            const selectedQuestions = await getQuestions(template_id, ip, path, query_string, email, json_config, forbiddenQJson, output, dedupServiceProject, 'false', [], isp);
            return selectedQuestions;
        } else if (static_articles == 'true') {
            // Decode and parse articlesArray
            articlesArray = decodeURIComponent(articlesArray);
            console.log('Decoded articlesArray:', articlesArray);
            // Construct the query for GetQuestionsWithImage
            const selectedQuestionsWithImage = await getQuestions(template_id, ip, path, query_string, email, [], [], output, dedupServiceProject, static_articles, articlesArray, isp);
            return selectedQuestionsWithImage;
        } else {
            throw new Error(
                "No valid case matched. Ensure all required parameters are provided and valid, including json_config, or static_articles."
            );
        }
     
    } catch (error) {
        console.error("Error in GetDBData:", error);
        output.success = false;
        output.message = error.message;

        return output;
    }
}


/**
 * Helper function to get questions from TriviaLogic
 * @param {number} templateId
 * @param {string} ip
 * @param {string} requestPath
 * @param {string} queryString
 * @param {string} email
 * @param {string} jsonConfig
 * @param {string} forbiddenQuestions
 * @param {Object} output
 * @param {string} dedupServiceProject
 * @returns {Promise<Object>}
 */
async function getQuestions(templateId, ip, requestPath, queryString, email, jsonConfig, forbiddenQuestions, output, dedupServiceProject, static_articles = 'false', articlesArray = [], isp = '') {
    try {
        let result;
        const triviaLogic = new NewsLogic(templateId, ip, requestPath, queryString, email, jsonConfig, forbiddenQuestions, dedupServiceProject, articlesArray, isp);

        if (static_articles === 'false') {
            result = await triviaLogic.main();
        } else {
            result = await triviaLogic.getArticlesWithImage();
        }

        if(!result.status) {
            output.success = false;
            output.message = 'Error during selection question execution:' + result.message;
            output.payload = [];
            return output;
        }

        output.success = true;
        output.message = 'Questions fetched successfully';
        output.payload = result.payload;
        return output;
    } catch (error) {
        output.success = false;
        output.message = 'Error during selection question execution:' + error;
        output.payload = [];
        return output;
    }
}


async function GetTriviaComponents(event) {
    try {
        let output = {
            success: true,
            functionName: 'GetTriviaComponents',
            message: '',
            payload: []
        };

        let template;

        // Fetch data using GetDBData function
        await GetDBData(event).then((data) => {
            template = data;
        });

        if(!template.success) {
            output.success = false;
            output.message = template.message;
            output.functionName = template.functionName;
            output.payload = template.payload;
            return output;
        }

        output.message = template.message;
        output.payload = template.payload;
        return output;
    } catch (error) {
        output.success = false;
        output.message = error.message;
        return output;
    }
}

/**
 * Main Driver
 * @param event
 * @param context
 * @param callback
 * @returns {Promise<{body: *, statusCode: number}|{body, statusCode: number}|{headers: {"Content-Type": string}, body: string, statusCode: number}>}
 */
exports.handler = async (event, context, callback) => {
    try {
        //prevent timeout from waiting event loop
        context.callbackWaitsForEmptyEventLoop = false;
        let output = {};

        //call GetTriviaComponents to get the questions and Template
        const templateResult = await GetTriviaComponents(event);
        if(!templateResult.success) {
            let o = {success: false, message: templateResult.message, payload: templateResult.payload};
            return {
                statusCode: 400,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(o),
            };
        }

        let results = await FormatJobHTML(templateResult.payload, event);
        if(!results.success) {
            let statusCode = results.statusCode === 404 ? 404 : 400;
            let o = {success: false, message: results.message, payload: results.payload, request: output.formattedRequest};
            return {
                statusCode: statusCode,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(o),
            };
        }

        let outputBody = {
            'success': true,
            'params': output.params,
            'formattedRequest': output.formattedRequest,
        };

        let contentType = 'application/json';

        // format of response;
        let response_format = ExtractQSParam(event, 'response_format');
        if (response_format === 'json') outputBody.hero_headline = results.hero_headline || '';
        switch(response_format) {
            case 'array': // json response
                outputBody.jobArray = results.jobArray;
                outputBody.slicedHtml = results.slicedHtml;
                outputBody = JSON.stringify(outputBody);
                break;
            case 'fullHtml': // json response
                outputBody.payload = results.payload;
                outputBody = JSON.stringify(outputBody);
                break;
            case 'rawHtml': // HTML response
                contentType = 'text/html';
                outputBody = results.payload;
                break;
            case '':
            case 'combined':
            default: // json response
                outputBody.payload = results.payload;
                outputBody.jobArray = templateResult.results;
                outputBody.slicedHtml = results.slicedHtml;
                outputBody = JSON.stringify(outputBody);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': contentType },
            body: outputBody
        };
    } catch (error) {
        let o = {success: false, message: error.message, payload: []};
        return {
            statusCode: 400,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(o),
        };
    }
};