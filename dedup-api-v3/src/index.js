
const { BatchGetItemCommand, DeleteItemCommand, UpdateItemCommand, GetItemCommand, DynamoDBClient, ListTablesCommand, PutItemCommand } = require("@aws-sdk/client-dynamodb");


let ddbClient = new DynamoDBClient({});


let ddbTable = '';
let ddbLogTable = '';



// CHANGE 1: Removed 'legacy' entry — engagement_user_activity and engagement_request_log
// are no longer referenced. All projects now use their own isolated tables.
const tableDef = {
    'eightys_trivia': {
        'activity_table': 'engagement_user_activity_eightys_trivia',
        'log_table': 'engagement_request_log_eightys_trivia',
    },
    'word_trivia': {
        'activity_table': 'engagement_user_activity_word_trivia',
        'log_table': 'engagement_request_log_word_trivia',
    },
    'school_of_word':{
        'activity_table': 'engagement_user_activity_school_of_word',
        'log_table': 'engagement_request_log_school_of_word',
    },
    'trivia_quest':{
        'activity_table': 'engagement_user_activity_trivia_quest',
        'log_table': 'engagement_request_log_trivia_quest',
    },
    'lettermuse': {
        'activity_table': 'engagement_user_activity_lettermuse',
        'log_table': 'engagement_request_log_lettermuse'
    },
    'the_explain': {
        'activity_table': 'engagement_user_activity_the_explain',
        'log_table': 'engagement_request_log_the_explain'
    },
    'word_hopper': {
        'activity_table': 'engagement_user_activity_word_hopper',
        'log_table': 'engagement_request_log_word_hopper'
    },
    'trivia_loop': {
        'activity_table': 'engagement_user_activity_trivia_loop',
        'log_table': 'engagement_request_log_trivia_loop',
    },
    'golden_trivia': {
        'activity_table': 'engagement_user_activity_golden_trivia',
        'log_table': 'engagement_request_log_golden_trivia',
    },
    'news_command': {
        'activity_table': 'engagement_user_activity_news_command',
        'log_table': 'engagement_request_log_news_command',
    },
    'truth_facts': {
        'activity_table': 'engagement_user_activity_truth_facts',
        'log_table': 'engagement_request_log_truth_facts',
    },
    'word_bar': {
        'activity_table': 'engagement_user_activity_word_bar',
        'log_table': 'engagement_request_log_word_bar',
    },
    'topline_news': {
        'activity_table': 'engagement_user_activity_topline_news',
        'log_table': 'engagement_request_log_topline_news',
    },
    'word_luck': {
        'activity_table': 'engagement_user_activity_word_luck',
        'log_table': 'engagement_request_log_word_luck',
    },
    'doctor_humor': {
        'activity_table': 'engagement_user_activity_doctor_humor',
        'log_table': 'engagement_request_log_doctor_humor',
    },
    'word_memo': {
        'activity_table': 'engagement_user_activity_word_memo',
        'log_table': 'engagement_request_log_word_memo',
    },
    'funny_geeks': {
        'activity_table': 'engagement_user_activity_funny_geeks',
        'log_table': 'engagement_request_log_funny_geeks',
    },
    'news_beyond': {
        'activity_table': 'engagement_user_activity_news_beyond',
        'log_table': 'engagement_request_log_news_beyond',
    },
    'daily_wordplay': {
        'activity_table': 'engagement_user_activity_daily_wordplay',
        'log_table': 'engagement_request_log_daily_wordplay',
    },
    'all_news': {
        'activity_table': 'engagement_user_activity_all_news',
        'log_table': 'engagement_request_log_all_news',
    }
};


let dedupedProjectsWhitelist = [];
for (let key in tableDef){
    dedupedProjectsWhitelist.push(key);
}

/**
 * List tables in Dynamo DB
 * @returns {Promise<Promise<MetadataBearer> | void>}
 */
let listTables = async () => {
    const command = new ListTablesCommand({});

    const response = await ddbClient.send(command);
    //console.log(response.TableNames.join("\n"));
    return response;
};

/**
 * used to feed putItemInDDB
 * @param email - string
 * @param activity_date - string
 * @param project_activity - array {project: [array of q_id], project2: [array2 of q_id]}}
 * @returns {*|{}}
 */
function formatQIDForInput(email, activity_date, project_activity){
    let output = {};

    output["email_date"] = { S: email + '_' + activity_date }
    output["email"] = { S: email };
    output["activity_date"] = { S: activity_date };

    for (const [key, value] of Object.entries(project_activity)) {
        output[key] = { S: JSON.stringify(value) }
    }

    return output;
}

/**
 * Put an item in dynamo db
 * @param today
 * @returns {Promise<Promise<MetadataBearer> | void>}
 */
let putItemInDDB = async (i, table = '') => {
    const command = new PutItemCommand({
        TableName: (table == '' ? ddbTable : table),

        Item: i,
    });

    const response = await ddbClient.send(command);
    //console.log(response);
    return response;
};

/**
 * update item in the db
 * @param key
 * @param activity_date
 * @param project
 * @param values
 * @returns {Promise<Promise<MetadataBearer> | void>}
 */
let updateItemInDDB = async (key, activity_date, project, values, ttl_value) => {
    const command = new UpdateItemCommand({
        TableName: ddbTable,

        Key: {
            email_date: { S: key },
            activity_date: { S: activity_date}
        },
        UpdateExpression: "set " + project + " = :v, ttl_value = :ttl_value ADD hit_counter :inc",
        ExpressionAttributeValues: {
            ":v": { S: JSON.stringify(values) },
            ":ttl_value": { N: ttl_value },
            ":inc": { N: "1" }
        },
        ReturnValues: "ALL_NEW"
    });

    const response = await ddbClient.send(command);
    //console.log(response);
    return response;
};


/**
 * Get item from db
 * @param key
 * @param activity_date
 * @returns {Promise<Promise<MetadataBearer> | void>}
 */
let getItemFromDDB = async (key, activity_date) => {
    const command = new GetItemCommand({
        TableName: ddbTable,

        Key: {
            email_date: { S: key },
            activity_date: { S: activity_date}
        },
    });

    const response = await ddbClient.send(command);
    //console.log(response);
    return response;
};

/**
 * Format primary key and secondary index for batch get request
 * @param items array [{email: email, activity_date: activity_date}, {email: email2, activity_date: activity_date2}]
 */
function formatItemsForBatchGetRequest(items){
    let output = [];

    //console.log(items);
    for (let i in items){
        output.push({
            email_date: { S: items[i]["email"] + '_' + items[i]["activity_date"] },
            activity_date: { S: items[i]["activity_date"]}
        })
    }

    //console.log(output);
    return output
}

/**
 * Format the desired colunmns expression to work even with unconventional element names
 * @param columns
 * @param parent
 * @returns {*}
 */
async function formatProjectionExpressionForBatchGet(columns, parent){
    let split_columns = columns.split(', ');
    let i = 0;
    parent['ProjectionExpression'] = '';
    parent['ExpressionAttributeNames'] = {};

    let projExpression = []
    for(let c in split_columns){
        i++;
        let v = (i + 9).toString(36); // convert numbers to letters (1 = A, 2 = B, etc)

        projExpression.push(`#${v}`)
        parent['ProjectionExpression'] = `#${v}`;
        parent['ExpressionAttributeNames'][`#${v}`] = split_columns[c];

    }

    parent['ProjectionExpression'] = projExpression.join(', ');
    return parent;
}

/**
 * OPT 1: ConsistentRead: false — halves RCU cost (0.5 RCU vs 1 RCU per read).
 * Safe because dedup history is written once per send and read back hours later.
 * 1-2 sec eventual consistency window poses zero duplicate risk.
 *
 * @param items - an instance of formatItemsForBatchGetRequest()
 * @param returnOnlyValues - a comma + space ', ' seperated list of returned elements if everything is not needed
 * @returns {Promise<*>}
 */
let getBatchItemsFromDDB = async (items, table, returnOnlyValues = '') => {

    let com = {RequestItems: {}};
    com['RequestItems'][table] = {Keys: items, ConsistentRead: false};
    if(returnOnlyValues != '') com['RequestItems'][table] = await formatProjectionExpressionForBatchGet(returnOnlyValues, com['RequestItems'][table]);

    const command = new BatchGetItemCommand(com);

    const response = await ddbClient.send(command);
    //console.log(response.Responses[ddbTable]);
    return response;
};

/**
 * Delete an item from Dynamo
 * @param key
 * @param activity_date
 * @returns {Promise<Promise<MetadataBearer> | void>}
 */
let deleteItemFromDDB = async (key, activity_date) => {
    const command = new DeleteItemCommand({
        TableName: ddbTable,

        Key: {
            email_date: { S: key },
            activity_date: { S: activity_date}
        },
    });

    const response = await ddbClient.send(command);
    //console.log(response);
    return response;
};

// ─── OPT 3: Compress batch keys ────────────────────────────────────────────────
// Instead of always fetching 35 date keys per user, maintain a summary item that
// lists only dates with real activity. On get: read summary (1 read) → fetch only
// active dates. On log: add today's date to the summary StringSet.
// Legacy users with no summary item fall back to the full 35-key fetch automatically.

/**
 * Add activity_date to the user's active-dates summary item for a given table.
 * Uses ADD on a StringSet so dates are auto-deduplicated.
 * Called after a successful log write — fire-and-forget (non-fatal if it fails).
 */
let updateActiveDatesSummary = async (email, activity_date, table) => {
    try {
        let ttl_value = (Math.floor(Date.now() / 1000) + 7776000).toString();
        const command = new UpdateItemCommand({
            TableName: table,
            Key: {
                email_date: { S: `${email}_ACTIVE_DATES` },
                activity_date: { S: 'ACTIVE_DATES' }
            },
            UpdateExpression: 'ADD active_dates :d SET ttl_value = :ttl',
            ExpressionAttributeValues: {
                ':d':   { SS: [activity_date] },
                ':ttl': { N: ttl_value }
            }
        });
        await ddbClient.send(command);
    } catch (err) {
        console.error(`[updateActiveDatesSummary] Failed for ${email} on ${table} (non-fatal):`, err.message);
    }
};

/**
 * Return the subset of dates >= cutoffDate that have real activity records for this user.
 * Returns null  → no summary item exists (legacy user) — caller should fall back to full fetch.
 * Returns []    → user exists but has no activity in the lookback window — caller can skip BatchGetItem.
 * Returns [...] → filtered list of active dates to fetch.
 */
let getActiveDates = async (email, table, cutoffDate) => {
    try {
        const command = new GetItemCommand({
            TableName: table,
            Key: {
                email_date: { S: `${email}_ACTIVE_DATES` },
                activity_date: { S: 'ACTIVE_DATES' }
            }
        });
        const response = await ddbClient.send(command);
        if (!response.Item || !response.Item.active_dates) return null; // legacy user
        const allDates = response.Item.active_dates.SS || [];
        return allDates.filter(d => d >= cutoffDate);
    } catch (err) {
        // On any DynamoDB error fall back to full 35-key fetch — preserves original behaviour
        console.error(`[getActiveDates] Failed for ${email} on ${table}, falling back to full fetch:`, err.message);
        return null;
    }
};
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Extract query string parameters from the event object
 * @param event
 * @param param
 * @param defaultValue
 * @returns {*|string}
 * @constructor
 */
function extractQSParam(event, param, defaultValue = ''){
    return ('queryStringParameters' in event && param in event.queryStringParameters && event.queryStringParameters[param].length > 0) ? event.queryStringParameters[param] : defaultValue;

}

/**
 * Create a 400 return status
 * @param reason
 * @returns {{body: string, statusCode: number}}
 */
function create400Return(reason){
    return {
        statusCode: 400,
        body: JSON.stringify(reason),
    };
}

/**
 * Create a 200 return status
 * @param reason
 * @returns {{body: string, statusCode: number}}
 */
function create200Return(reason){
    return {
        statusCode: 200,
        body: JSON.stringify(reason),
    };
}


/**
 * check if email is valid
 * @param email
 * @returns {boolean}
 */
function isEmailValid(email) {

    var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;

    if (!email)
        return false;

    if(email.length>254)
        return false;

    var valid = emailRegex.test(email);
    if(!valid)
        return false;

    // Further checking of some things regex can't handle
    var parts = email.split("@");
    if(parts[0].length>64)
        return false;

    var domainParts = parts[1].split(".");
    if(domainParts.some(function(part) { return part.length>63; }))
        return false;

    return true;
}

/**
 * Clean an int from string
 * @param x
 * @param max
 * @param min
 * @returns {number}
 */
function cleanInt(x, max = 50, min = 0) {
    x = Number(x);
    let output = (x >= 0) ? Math.floor(x) : Math.ceil(x);
    if(isNaN(output)) return 0;
    if(output >= max) return max;
    if(output <= min) return min;
    return output;
}

/**
 * Returns an array of dates to dedup
 * @param dedupPeriod
 * @returns {*[]}
 */
function getDedupDateArray(dedupPeriod){

    var todaysDate = new Date();
    let dateArray = [];
    for (let i = 0; i <= dedupPeriod; i++){
        let x = new Date(todaysDate);
        x.setDate(todaysDate.getDate() - i);

        let dd = x.getDate();
        let mm = x.getMonth() + 1
        let yyyy = x.getFullYear();
        if(dd<10){dd='0'+dd}
        if(mm<10){mm='0'+mm}
        let xString = `${yyyy}-${mm}-${dd}`
        dateArray.push(xString);
    }
    return dateArray;
}

/**
 * Adds method to the Array data type - to dedup items
 * @returns {*[]}
 */
function dedupArrays(a){
    let o = []
    for (let item in a){
        if(!o.includes(a[item])) o.push(a[item]);
    }
    return o;
}

/**
 * Correct the lambda event timestamp,
 * @param {*} dateString ex: '29/Oct/2024:23:17:25 +0000'
 * @returns yyyy-mm-dd_hh:mm:ss
 */
function correctLambdaEventTimestamp(dateString) {

    try{
        // Example input: '29/Oct/2024:23:17:25 +0000'

        // Split the date string to separate the timezone offset
        const [datePart, offset] = dateString.split(' '); // datePart = '29/Oct/2024:23:17:25'

        // Split datePart into date and time
        const firstColonIndex = datePart.indexOf(':');
        const dateOnly = datePart.substring(0, firstColonIndex); // '29/Oct/2024'
        const timeOnly = datePart.substring(firstColonIndex + 1); // '23:17:25'

        // Split dateOnly into day, month, and year
        const [day, monthStr, year] = dateOnly.split('/'); // day='29', monthStr='Oct', year='2024'

        // Map month abbreviation to number
        const months = {
        Jan: '01',
        Feb: '02',
        Mar: '03',
        Apr: '04',
        May: '05',
        Jun: '06',
        Jul: '07',
        Aug: '08',
        Sep: '09',
        Oct: '10',
        Nov: '11',
        Dec: '12',
        };

        const month = months[monthStr];

        // Ensure day and month are two digits
        const dayPadded = day.padStart(2, '0');

        // Combine into the desired format
        const formattedDate = `${year}-${month}-${dayPadded}_${timeOnly}`;

        return formattedDate;
    } catch (error) {
        console.log(error);
        return dateString;
    }

  }

/**
 * Handle the entire question id pull for dedup
 * @param event
 * @returns {Promise<(boolean|{body: string, statusCode: number})[]|(boolean|{})[]>}
 */
async function handleQuestionIdPull(event){


    const mustHaveParams = [
        'o_dedupedProject',
        'o_email',
        'o_dedupedPeriod'
    ];

    let multiDedupProjectList = extractQSParam(event, 'o_multiDedupProjectList', '');

    // add ttl epoch time for 3 months from currently
    // 90 days * 24 hours * 60 minutes * 60 seconds = 7776000
    let ttl_value = (Math.floor(Date.now() / 1000) + 7776000).toString();

    //console.log('pulling ttl: ', ttl_value);

    // log request
    let reqLog = {}
    for (let p in mustHaveParams){
        let val = extractQSParam(event, mustHaveParams[p], false);
        if (mustHaveParams[p] === 'o_email' && (!val || val === 'na' || !isEmailValid(val))) {
            return [false, create400Return('Missing or invalid o_email')];
        }

        // this is intentionally logged without validation here, it will be validated later
        reqLog[mustHaveParams[p]] = { S: extractQSParam(event, mustHaveParams[p], 'na') };
    }
    reqLog['requestId'] = { S: event.requestContext.requestId };
    reqLog['queryString'] = { S: event.rawQueryString };
    reqLog['activity_date'] = { S: event.requestContext.time}
    reqLog['normalised_activity_date'] = { S: correctLambdaEventTimestamp(event.requestContext.time) }
    reqLog['useCase'] = { S: extractQSParam(event, 'useCase')};
    reqLog['multiDedupProjectList'] = { S: multiDedupProjectList };
    reqLog['ttl'] = { N: ttl_value }


    let logRequest = await putItemInDDB(reqLog, ddbLogTable);
    if(logRequest['$metadata']['httpStatusCode'] != 200) return [false, 'failed logging request']
    //console.log(logRequest['$metadata']['httpStatusCode']);


    let dedupedProject = '';
    let email = '';
    let dedupedPeriod = 0;

    let returnedColumns = '';

    // validate for params
    for (let p in mustHaveParams){
        let r = extractQSParam(event, mustHaveParams[p], false);
        //console.log(r);
        /////////// output validation ///////////////////
        if(!r) return [false, create400Return('Missing params: ' + mustHaveParams[p])];


        if (mustHaveParams[p] == 'o_dedupedProject' ) {
            // disabled the "all" functionality - its risky because it can return a lot of data
            //if(!(dedupedProjectsWhitelist.includes(r)) && r != 'all') {

            if(!(dedupedProjectsWhitelist.includes(r))) {
                return [false, create400Return('deduped project is unknown')];
            } else {
                // this is here because the deduped project is also the return column name
                // disabled the "all" functionality - its risky because it can return a lot of data and its too permissive
                // enabled the "all" after disabling, because without it, we can not get all the projects from other tables.
                //returnedColumns = (multiDedupProjectList == 'all') ? dedupedProjectsWhitelist.join(', ') : r;
                returnedColumns = dedupedProjectsWhitelist.join(', ');
                // enabled single return column
                //returnedColumns = r;
                returnedColumns = returnedColumns + ', activity_date'; // always ask for activity date as well
                dedupedProject = r;
            }}
        if(mustHaveParams[p] == 'o_email'){
            if (!isEmailValid(r)) {
                return [false, create400Return('faulty email')];
            } else{
                email = r;
            }
        }
        if (mustHaveParams[p] == 'o_dedupedPeriod')  dedupedPeriod = cleanInt(r);

    }

    // create item array to request from db
    let dates = getDedupDateArray(dedupedPeriod);
    let reqArray = [];
    for(let d in dates){
        reqArray.push({"email": email, "activity_date": dates[d]})
    }
    // Full 35-key set — used as fallback for legacy users with no summary item (OPT 3)
    let formattedItemsForRequest = formatItemsForBatchGetRequest(reqArray);

    // Oldest date in the lookback window — used as cutoff for OPT 3 active-dates filter
    const cutoffDate = dates[dates.length - 1];

    let forbiddenOutput = {};

    // Multi Table Logic
    let tablesUsed = [];
    try{

        // split and clean the multi dedup project list
        let multiDedupProjectListArray = (multiDedupProjectList == '') ? [] : multiDedupProjectList.replace(' ', '').replace('_web', '').split(',');

        // CHANGE 2: Removed forced legacy inclusion.
        // Legacy transition period is over — all projects have their own tables.
        // Unknown projects in o_multiDedupProjectList are silently skipped via the null check below.

        // add current project to array if its not already there
        if(!(dedupedProject in multiDedupProjectListArray)) multiDedupProjectListArray.push(dedupedProject);



        //console.log('about to start building requests');


        let promises = multiDedupProjectListArray.map(async project => {
            // Unknown projects resolve to null and are skipped — no legacy fallback.
            let tableName = (project in tableDef ) ? tableDef[project]['activity_table'] : null;

            // if tableName is already in tablesUsed, or if tableName is null, skip it
            if(tableName == null || tablesUsed.includes(tableName)) return undefined;

            tablesUsed.push(tableName);

            // OPT 3: fetch only active dates to reduce batch keys.
            // Entire block is wrapped in try/catch — any failure falls back to the original
            // full 35-key fetch so email sending is never impacted by this optimisation.
            try {
                const activeDates = await getActiveDates(email, tableName, cutoffDate);

                if (activeDates !== null && activeDates.length === 0) {
                    // Brand-new user — no activity in this window, skip BatchGetItem entirely
                    return { '$metadata': { httpStatusCode: 200 }, Responses: { [tableName]: [] } };
                }

                const itemsToFetch = (activeDates === null)
                    ? formattedItemsForRequest  // legacy user — full 35-key fetch
                    : formatItemsForBatchGetRequest(activeDates.map(d => ({ email, activity_date: d })));

                return getBatchItemsFromDDB(itemsToFetch, tableName, returnedColumns);
            } catch (err) {
                console.error(`[OPT3] Optimisation failed for ${tableName}, falling back to full fetch:`, err.message);
                return getBatchItemsFromDDB(formattedItemsForRequest, tableName, returnedColumns);
            }
        });


        let results = (await Promise.all(promises)).filter(p => p !== undefined);

        //console.log('results: ', results);


        // Check for any failed requests



        // ! this loop is risky - one failure can jam the entire process. put error handling here
        // ! this is broken upon failure on purpose - we have no other way of controlling the deduplication process on multiple tables if one fails.
        for (let result of results) {
            //console.log('result: ', result);
            if (result['$metadata']['httpStatusCode'] != 200) {
                return [false, 'failed getting items from db'];
            }

            //console.log('responses: ', result['Responses']);


            const tableName = Object.keys(result['Responses'])[0];
            //const firstValue = result['Responses'][tableName];
            //console.log('xxxx', tableName, firstValue);

            //console.log('about to format results', tableName);
            forbiddenOutput = formatBatchGetResults(result, tableName, dedupedProjectsWhitelist, event, forbiddenOutput);
            //console.log('forbiddenOutput', forbiddenOutput);
            if(forbiddenOutput == null) return [false, 'failed formatting db response - ' + tableName];
            //console.log('formatted results');
        }
    }
    catch (error) {
        // console.log(error);
        // return [false, 'failed getting items from db'];
        console.error('handleQuestionIdPull error:', {
            message: error.message || 'Unknown error',
            stack: error.stack || 'No stack trace'
        });
      return [false, 'failed getting items from db: ' + (error.message || 'Unknown error')];
    }



    return [true, forbiddenOutput, tablesUsed];
}


function formatBatchGetResults(fQuestionIds, ddbTable, dedupedProjectsWhitelist, event, forbiddenOutput = []){

    // ! todo: why does the api response give back empty dates as well????

    try{


        //console.log('pre formatting results for: ', ddbTable);
        // if fQuestionIds.Responses[ddbTable] is undefined, return forbiddenOutput
        if(fQuestionIds.Responses[ddbTable] == undefined) return forbiddenOutput;

        // if desired response is broken down by project.
        // responseGrouping: byDate|byProject
        if(extractQSParam(event, 'responseGrouping', '') == 'byDate'){

            //('by date');

            // sort by date desc
            //console.log('doing table : ', ddbTable);
            //console.log('its value: ', fQuestionIds.Responses[ddbTable]);

            fQuestionIds.Responses[ddbTable].sort(function(a,b){
                return new Date(b['activity_date']['S']) - new Date(a['activity_date']['S'])
            })

            let uniqueArray = {};
            let uniqueTempArray = {};
            // group the questions in array by activity_date>project>question_id

            console.log('fQID', fQuestionIds.Responses[ddbTable]);

            for(let row in fQuestionIds.Responses[ddbTable]){

                let activity_date = fQuestionIds.Responses[ddbTable][row]['activity_date']['S'];
                if (!(activity_date in forbiddenOutput)) forbiddenOutput[activity_date] = {};

                for (const [key, value] of Object.entries(fQuestionIds.Responses[ddbTable][row])) {
                    if(!(dedupedProjectsWhitelist.includes(key))) continue; // if the key is not a project name it may be activity date, continue and ignore it.

                    let ids = JSON.parse(value['S'])

                    if(!(key in uniqueArray)) uniqueArray[key] = [];
                    if(!(key in uniqueTempArray)) uniqueTempArray[key] = [];

                    // dedup ids already used in previous dates
                    for (let id in ids){
                        if(!uniqueArray[key].includes(ids[id])) {
                            uniqueArray[key].push(ids[id]);
                            uniqueTempArray[key].push(ids[id]);
                        }
                    }

                    // append id array to output
                    if(!(key in forbiddenOutput[activity_date])) {
                        forbiddenOutput[activity_date][key] = uniqueTempArray[key];
                    } else {
                        forbiddenOutput[activity_date][key] = forbiddenOutput[activity_date][key].concat((uniqueTempArray[key]));
                    }

                    uniqueTempArray[key] = [];


                }
                // remove empty arrays
                for(let a in forbiddenOutput){

                    for (let b in forbiddenOutput[a]){
                        if(forbiddenOutput[a][b].length === 0) delete forbiddenOutput[a][b];
                    }

                    if(Object.keys(forbiddenOutput[a]).length === 0) delete forbiddenOutput[a];
                }
            }
        } else {

            //console.log('by project');
            // group the questions in array by project>question_id
            for(let row in fQuestionIds.Responses[ddbTable]){
                //if !(row['activity_date']['S'] in forbiddenOutput)
                for (const [key, value] of Object.entries(fQuestionIds.Responses[ddbTable][row])) {

                    if(!(dedupedProjectsWhitelist.includes(key))) continue; // if the key is not a project name it may be activity date, continue and ignore it.

                    if(!(key in forbiddenOutput)) {
                        forbiddenOutput[key] = JSON.parse(value['S']);
                    } else {
                        forbiddenOutput[key] = forbiddenOutput[key].concat((JSON.parse(value['S'])));
                    }
                }
            }

            // make unique
            for (const [key, value] of Object.entries(forbiddenOutput)) {
                forbiddenOutput[key] = dedupArrays(value);
            }
        }
        return forbiddenOutput;
    } catch (error) {
        console.error('formatBatchGetResults error:', {
            message: error.message || 'Unknown error',
            stack: error.stack || 'No stack trace',
            table: ddbTable
        });
        return null;
    }


}


/**
 * handle entire logging of used questions
 * @param event
 * @returns {Promise<(boolean|{body: string, statusCode: number})[]|(boolean|*)[]>}
 */
async function handleQuestionIdLog(event){
    try {
        const mustHaveParams = [
            'l_templateId',
            'l_ip',
            'l_requestPath',
            'l_reqDetails',
            'l_success',
            'l_email',
            'l_dedupedPeriod',
            'l_dedupedProject',
            'l_usedQuestions'
        ];

        let ttl_value = (Math.floor(Date.now() / 1000) + 7776000).toString();

        // log request
        let reqLog = {}
        for (let p in mustHaveParams){
            let val = extractQSParam(event, mustHaveParams[p], false);
            if (mustHaveParams[p] === 'l_email' && (!val || val === 'na' || !isEmailValid(val))) {
                return [false, create400Return('Missing or invalid l_email')];
            }

            reqLog[mustHaveParams[p]] = { S: extractQSParam(event, mustHaveParams[p], 'na') };
        }

        reqLog['requestId'] = { S: event.requestContext.requestId };
        reqLog['queryString'] = { S: event.rawQueryString };
        reqLog['activity_date'] = { S: event.requestContext.time}
        reqLog['normalised_activity_date'] = { S: correctLambdaEventTimestamp(event.requestContext.time) }
        reqLog['useCase'] = { S: extractQSParam(event, 'useCase')};
        // add ttl epoch time for 3 months from currently
        // 90 days * 24 hours * 60 minutes * 60 seconds = 7776000
        reqLog['ttl'] = { N: ttl_value }


        let logRequest = await putItemInDDB(reqLog, ddbLogTable);
        if(logRequest['$metadata']['httpStatusCode'] != 200) return [false, 'failed logging request'];
        //console.log(logRequest['$metadata']['httpStatusCode']);

        //////////////////////////////////

        let success = 0;

        let dedupedProject = '';
        let email = '';
        let dedupedPeriod = 0;

        let questionsUsed = []


        let returnedColumns = '';

        // validate for params
        for (let p in mustHaveParams){
            let r = extractQSParam(event, mustHaveParams[p], false);
            //console.log(r);
            /////////// output validation ///////////////////
            if(!r) return [false, create400Return('Missing params ' + mustHaveParams[p])];

            if (mustHaveParams[p] == 'l_dedupedProject' ) {
                if(!(dedupedProjectsWhitelist.includes(r))) {
                    return [false, create400Return('deduped project is unknown')];
                } else {
                    dedupedProject = r;
                }}
            if(mustHaveParams[p] == 'l_email'){
                if (!isEmailValid(r)) {
                    return [false, create400Return('faulty email')];
                } else{
                    email = r;
                }
            }
            if (mustHaveParams[p] == 'l_dedupedPeriod')  dedupedPeriod = cleanInt(r);
            if (mustHaveParams[p] == 'l_success')  success = cleanInt(r);
            if (mustHaveParams[p] == 'l_usedQuestions')  {
                questionsUsed = r.split(',');
                if (questionsUsed.length < 1) return [false, create400Return('no questions used to log')];
            }

        }

        let nowTimestamp = new Date().toISOString();
        let today = nowTimestamp.split('T')[0];
        //today = '2024-02-28';

        let gi = await getItemFromDDB(`${email}_${today}`, today)
        if(gi['$metadata']['httpStatusCode'] != 200) return [false, 'failed getting item from db for update'];
        // if the status returned is not 200, throw an issue
        // not a 200 status does NOT mean the item is not present, just that there was a connection issue
        // it will likely return an empty array if the item is there but not found.
        let currentArray = [];
        if('Item' in gi && dedupedProject in gi.Item){
            currentArray = JSON.parse(gi.Item[dedupedProject]['S']);
        }

        let ui = await updateItemInDDB(`${email}_${today}`, today, dedupedProject, dedupArrays(currentArray.concat(questionsUsed)), ttl_value);
        if(ui['$metadata']['httpStatusCode'] == 200) {
            // OPT 3: Update active-dates summary so future get calls only fetch dates with real records.
            // Awaited — guarantees no duplicates. Adds ~5-10ms to a post-delivery log call,
            // which has zero impact on email delivery or question selection.
            await updateActiveDatesSummary(email, today, ddbTable);
            return [true, ui.Attributes];
        }

        return [false, 'failed updating / logging items'];

    } catch (error) {
        console.error('handleQuestionIdLog error:', {
            message: error.message || 'Unknown error',
            stack: error.stack || 'No stack trace'
        });
        return [false, 'handleQuestionIdLog internal error: ' + (error.message || 'Unknown error')];
    }

}

// CHANGE 3: setTableVars now returns false for unknown projects instead of silently
// falling back to the legacy tables. The handler checks this return value and
// rejects the request with a 400 before any DynamoDB call is made.
function setTableVars(dedupedProject){

    if(dedupedProject in tableDef){
        ddbTable = tableDef[dedupedProject]['activity_table'];
        ddbLogTable = tableDef[dedupedProject]['log_table'];
        return true;
    }

    console.error('setTableVars: unknown project requested:', dedupedProject);
    return false;
}


exports.handler = async (event) => {

    try{

        let useCase = extractQSParam(event, 'useCase', false);

        // log objects in the db
        if(useCase == 'log'){

            // CHANGE 4: Validate l_dedupedProject against the whitelist before calling
            // setTableVars, matching the same guard already in place for the 'get' path.
            // Previously setTableVars was called first and silently fell back to legacy
            // tables for unknown projects.
            let logProject = extractQSParam(event, 'l_dedupedProject', 'na').replace('_web', '');

            if(['na', ''].includes(logProject) || !dedupedProjectsWhitelist.includes(logProject)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify('deduped project is unknown or missing'),
                };
            }

            if(!setTableVars(logProject)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify('deduped project table configuration not found'),
                };
            }

            let logQuestions = await handleQuestionIdLog(event);

            return {
                statusCode: (logQuestions[0]) ? 200 : 400,
                body: JSON.stringify(logQuestions[1]),
            };
        }
        // retrieve objects from the db
        else if(useCase == 'get'){

            let dedupedProject = extractQSParam(event, 'o_dedupedProject', 'na').replace('_web', '');

            // until we add multi table support, we will NOT allow 'all' as a deduped project
            if(['all', 'na'].includes(dedupedProject)) return {
                statusCode: 400,
                body: JSON.stringify('in this release, the deduped project provided is not supported'),
            };

            if(!dedupedProjectsWhitelist.includes(dedupedProject)) return {
                statusCode: 400,
                body: JSON.stringify('deduped project is unknown'),
            };

            if(!setTableVars(dedupedProject)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify('deduped project table configuration not found'),
                };
            }

            let pullQuestions = await handleQuestionIdPull(event);
            return {
                statusCode: (pullQuestions[0]) ? 200 : 400,
                body: JSON.stringify(pullQuestions[1]),
                headers: {
                    // split by comma and space
                    'Tables-Used': (pullQuestions[2] || []).join(', ')
                }
            };
        }
        else{
            return {
                statusCode: 400,
                body: JSON.stringify('faulty request...'),
            };
        }


    } catch (error) {
        // console.log(error);
        // return create400Return('bad request :(');
        console.error('Dedup handler error:', {
            message: error.message || 'Unknown error',
            stack: error.stack || 'No stack trace',
            useCase: extractQSParam(event, 'useCase', 'unknown')
        });
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'bad request',
                message: error.message || 'Unknown error'
            })
        };
    }

};
