const express = require('express');
const router = express.Router();
const { synthesize } = require('../services/eleven-labs');

router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text (string) required' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return res.status(500).json({ error: 'ElevenLabs not configured' });
  }

  try {
    const audioBuffer = await synthesize(text, apiKey, voiceId);
    const base64 = audioBuffer.toString('base64');
    res.json({
      audio: base64,
      contentType: 'audio/mpeg'
    });
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(502).json({ error: 'TTS generation failed', fallback: true });
  }
});

module.exports = router;
