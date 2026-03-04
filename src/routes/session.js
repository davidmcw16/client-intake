const express = require('express');
const router = express.Router();
const { createSession, getSession } = require('../services/session-manager');
const { startConversation, processMessage } = require('../services/conversation-engine');

// Create a new intake session
router.post('/', async (req, res) => {
  try {
    const session = await createSession();
    const result = await startConversation(session);
    res.json({
      sessionId: session.id,
      message: result.message
    });
  } catch (err) {
    console.error('Session creation error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// Get session status
router.get('/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({
    sessionId: session.id,
    isComplete: session.is_complete,
    turnCount: session.turn_count,
    clientName: session.client_name
  });
});

// Send a message
router.post('/:id/message', async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) required' });
  }

  const session = await getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.is_complete) {
    return res.status(400).json({ error: 'Session already complete' });
  }

  try {
    const result = await processMessage(session, message.trim());
    res.json({
      message: result.message,
      isComplete: result.isComplete
    });
  } catch (err) {
    console.error('Message processing error:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

module.exports = router;
