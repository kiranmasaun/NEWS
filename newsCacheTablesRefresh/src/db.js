const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host:               process.env.db_host,
    user:               process.env.db_user,
    password:           process.env.db_password,
    database:           process.env.db_name,
    waitForConnections: true,
    connectionLimit:    5,
    multipleStatements: true,
});

module.exports = pool;
