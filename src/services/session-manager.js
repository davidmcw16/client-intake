const db = require('./db');

const sessions = new Map();

function createSession(sessionId) {
  const session = {
    sessionId,
    createdAt: new Date(),
    conversationHistory: [],
    coveredCategories: [],
    confidence: {
      vision: 0.0, users_problem: 0.0, core_features: 0.0,
      user_journey: 0.0, look_feel: 0.0, integrations: 0.0,
      scale: 0.0, constraints: 0.0
    },
    isComplete: false,
    turnCount: 0,
    clientName: null,
    expiryTimeout: null
  };

  session.expiryTimeout = setTimeout(() => deleteSession(sessionId), 24 * 60 * 60 * 1000);
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (updates.confidence) {
    Object.assign(session.confidence, updates.confidence);
    const { confidence, ...rest } = updates;
    Object.assign(session, rest);
  } else {
    Object.assign(session, updates);
  }

  return session;
}

async function persistSession(sessionId, markdown) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const result = await db.saveIntake({
    sessionId,
    clientName: session.clientName,
    conversation: session.conversationHistory.filter(m => m.role !== 'system'),
    markdown,
    turnCount: session.turnCount,
    confidence: session.confidence,
    durationMs: Date.now() - session.createdAt.getTime(),
    createdAt: session.createdAt
  });

  clearTimeout(session.expiryTimeout);
  sessions.delete(sessionId);
  return result;
}

function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    if (session.expiryTimeout) clearTimeout(session.expiryTimeout);
    sessions.delete(sessionId);
  }
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  persistSession,
  deleteSession
};
