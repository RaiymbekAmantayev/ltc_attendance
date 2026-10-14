const mysql = require('mysql2/promise');
const { databaseUrl } = require('./env');

const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 10, timezone: 'Z', dateStrings: true });

// Все метки времени храним в UTC, независимо от настроек сервера MySQL.
pool.pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));

/** Возвращает только строки результата. */
const query = async (sql, params) => (await pool.query(sql, params))[0];

module.exports = { pool, query };
