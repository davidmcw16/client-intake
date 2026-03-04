const { v4: uuidv4 } = require('uuid');
const db = require('./db');

async function createSession() {
  const sessionId = uuidv4();
  return db.createSession(sessionId);
}

async function getSession(sessionId) {
  return db.getSession(sessionId);
}

async function updateSession(sessionId, updates) {
  return db.updateSession(sessionId, updates);
}

async function listCompletedSessions() {
  return db.listCompletedSessions();
}

async function listAllSessions() {
  return db.listAllSessions();
}

module.exports = { createSession, getSession, updateSession, listCompletedSessions, listAllSessions };
