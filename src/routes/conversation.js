const express = require('express');
const router = express.Router();
const conversationEngine = require('../services/conversation-engine');

// POST /api/session/:id/message — Send client message, get AI response
router.post('/:id/message', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const result = await conversationEngine.processMessage(id, message);
    res.json(result);
  } catch (err) {
    console.error('Conversation error:', err);
    if (err.message && (err.message.includes('not found') || err.message.includes('Session'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.status(500).json({ error: 'Failed to process message' });
  }
});

module.exports = router;
