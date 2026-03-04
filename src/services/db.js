const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      is_complete BOOLEAN DEFAULT false,
      messages JSONB DEFAULT '[]'::jsonb,
      markdown TEXT,
      client_name TEXT,
      turn_count INTEGER DEFAULT 0
    )
  `);
}

async function createSession(sessionId) {
  const result = await pool.query(
    'INSERT INTO sessions (id) VALUES ($1) RETURNING *',
    [sessionId]
  );
  return result.rows[0];
}

async function getSession(sessionId) {
  const result = await pool.query(
    'SELECT * FROM sessions WHERE id = $1',
    [sessionId]
  );
  return result.rows[0] || null;
}

async function updateSession(sessionId, updates) {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const result = await pool.query(
    `UPDATE sessions SET ${setClause} WHERE id = $1 RETURNING *`,
    [sessionId, ...values]
  );
  return result.rows[0];
}

async function listCompletedSessions() {
  const result = await pool.query(
    'SELECT * FROM sessions WHERE is_complete = true ORDER BY completed_at DESC'
  );
  return result.rows;
}

async function listAllSessions() {
  const result = await pool.query(
    'SELECT * FROM sessions ORDER BY created_at DESC'
  );
  return result.rows;
}

module.exports = { initDB, createSession, getSession, updateSession, listCompletedSessions, listAllSessions };
