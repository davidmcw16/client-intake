const { Pool, neonConfig } = require("@neondatabase/serverless");
const ws = require("ws");

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initialize() {
  // Migrate existing UUID column to VARCHAR(255) if needed
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'intakes' AND column_name = 'session_id' AND data_type = 'uuid'
      ) THEN
        ALTER TABLE intakes ALTER COLUMN session_id TYPE VARCHAR(255) USING session_id::VARCHAR;
      END IF;
    END $$;
  `).catch(() => {}); // Ignore if table doesn't exist yet

  await pool.query(`
    CREATE TABLE IF NOT EXISTS intakes (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(255) NOT NULL UNIQUE,
      client_name VARCHAR(255) DEFAULT 'Client',
      conversation JSONB NOT NULL,
      markdown TEXT NOT NULL,
      turn_count INTEGER,
      confidence JSONB,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intakes_created_at ON intakes (created_at DESC)
  `);
}

async function saveIntake({
  sessionId,
  clientName,
  conversation,
  markdown,
  turnCount,
  confidence,
  durationMs,
  createdAt,
  completedAt,
}) {
  const result = await pool.query(
    `INSERT INTO intakes (session_id, client_name, conversation, markdown, turn_count, confidence, duration_ms, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id) DO NOTHING
     RETURNING *`,
    [
      sessionId,
      clientName,
      JSON.stringify(conversation),
      markdown,
      turnCount,
      JSON.stringify(confidence),
      durationMs,
      createdAt,
      completedAt || new Date().toISOString(),
    ]
  );
  return result.rows[0];
}

async function getAllIntakes() {
  const result = await pool.query(
    `SELECT * FROM intakes ORDER BY created_at DESC`
  );
  return result.rows;
}

async function getIntakeBySessionId(sessionId) {
  const result = await pool.query(
    `SELECT * FROM intakes WHERE session_id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

async function getIntakeById(id) {
  const result = await pool.query(
    `SELECT * FROM intakes WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function deleteIntake(id) {
  const result = await pool.query(
    `DELETE FROM intakes WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  initialize,
  saveIntake,
  getAllIntakes,
  getIntakeBySessionId,
  getIntakeById,
  deleteIntake,
};
