const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../services/db');
const { generateMarkdown, generateFallback } = require('../services/markdown-generator');

/**
 * Verify ElevenLabs HMAC-SHA256 webhook signature.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 */
function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// POST /api/webhook
// IMPORTANT: This route needs express.raw() middleware, NOT express.json()
// The raw body is needed for HMAC verification before JSON parsing
router.post('/', async (req, res) => {
  try {
    // 1. Verify HMAC signature
    const signature = req.headers['elevenlabs-signature'];
    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

    if (!verifySignature(req.body, signature, secret)) {
      console.warn('Webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. Parse the raw body
    const payload = JSON.parse(req.body.toString());

    // 3. Extract data from webhook payload
    const {
      conversation_id,
      transcript = [],
      analysis = {},
      metadata = {},
    } = payload;

    if (!conversation_id) {
      return res.status(400).json({ error: 'Missing conversation_id' });
    }

    const clientName = analysis.client_name || 'Client';
    const turnCount = metadata.turn_count || transcript.length;
    const durationSeconds = metadata.duration_seconds || 0;

    // 4. Build confidence object from analysis fields
    const confidence = {
      vision: analysis.confidence_vision || 0,
      users_problem: analysis.confidence_users || 0,
      core_features: analysis.confidence_features || 0,
      user_journey: analysis.confidence_journey || 0,
      look_feel: analysis.confidence_design || 0,
      integrations: analysis.confidence_integrations || 0,
      scale: analysis.confidence_scale || 0,
      constraints: analysis.confidence_constraints || 0,
    };

    // 5. Generate markdown brief via Claude API (with fallback)
    let markdown;
    try {
      markdown = await generateMarkdown(
        transcript,
        clientName,
        { durationSeconds, turnCount }
      );
    } catch (err) {
      console.error('Markdown generation failed, using fallback:', err.message);
      markdown = generateFallback(
        transcript,
        clientName,
        { durationSeconds, turnCount }
      );
    }

    // 6. Convert transcript format for DB storage
    // ElevenLabs: {role: "agent"|"user", message: "..."}
    // DB storage: {role: "assistant"|"user", content: "..."}
    const conversation = transcript.map(t => ({
      role: t.role === 'agent' ? 'assistant' : 'user',
      content: t.message,
    }));

    // 7. Persist to Neon DB
    await db.saveIntake({
      sessionId: conversation_id,
      clientName,
      conversation,
      markdown,
      turnCount,
      confidence,
      durationMs: durationSeconds * 1000,
      createdAt: metadata.start_time || new Date().toISOString(),
      completedAt: metadata.end_time || new Date().toISOString(),
    });

    console.log(`Webhook processed: ${conversation_id} (${clientName}, ${turnCount} turns)`);
    res.json({ status: 'ok' });

  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
