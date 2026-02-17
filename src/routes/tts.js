const express = require('express');
const router = express.Router();
const elevenLabs = require('../services/eleven-labs');

// POST /api/tts — Text-to-speech proxy
router.post('/', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const result = await elevenLabs.textToSpeech(text);
    res.json(result);
  } catch (err) {
    console.error('TTS error:', err);
    res.json({ fallback: true });
  }
});

module.exports = router;
