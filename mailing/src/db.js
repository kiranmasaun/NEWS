// db.js - A separate module for the global connection pool
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env['db_host'],
  user: process.env['db_user'],
  password: process.env['db_password'],
  database: process.env['db_name'],
  port: 3306,
  decimalNumbers: true, // Force numeric results to be returned as numbers
  multipleStatements: true
});

module.exports = pool;