const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'quiz.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

// Migrazioni per DB creati prima di queste colonne (CREATE TABLE IF NOT EXISTS non le aggiunge).
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumnIfMissing('users', 'role', "TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))");
addColumnIfMissing('topics', 'active', 'INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))');
addColumnIfMissing('questions', 'active', 'INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))');

require('./seed')(db);

module.exports = db;
