const postgres = require('postgres');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to connect to the database');
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

module.exports = sql;
