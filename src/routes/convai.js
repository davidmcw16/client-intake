const express = require('express');
const router = express.Router();

router.get('/signed-url', async (req, res) => {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!agentId || !apiKey) {
    return res.status(500).json({ error: 'ElevenLabs ConvAI not configured' });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      { headers: { 'xi-api-key': apiKey } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    res.json({ signed_url: data.signed_url });
  } catch (err) {
    console.error('Signed URL error:', err.message);
    res.status(502).json({ error: 'Failed to get signed URL' });
  }
});

module.exports = router;
