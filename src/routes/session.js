const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const conversationEngine = require('../services/conversation-engine');

// POST /api/session — Create new intake session
router.post('/', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const result = await conversationEngine.startConversation(sessionId);
    res.json(result);
  } catch (err) {
    console.error('Session creation error:', err);
    res.status(500).json({
      error: 'Failed to start session',
      message: "Hi! I'm here to learn about your project idea. Let's start simple -- what's your name, and what do you want to build?"
    });
  }
});

module.exports = router;
