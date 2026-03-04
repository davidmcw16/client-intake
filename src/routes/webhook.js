const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const llm = require('../services/llm');
const { PRP_SYNTHESIS_PROMPT, PRP_DEVELOPER_PROMPT } = require('../prompts/system-prompt');

function verifySignature(req) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured
  const sig = req.headers['elevenlabs-signature'];
  if (!sig) return false;
  // Format: t=<timestamp>,v0=<hash>
  const parts = {};
  sig.split(',').forEach(p => {
    const [k, v] = p.split('=');
    parts[k] = v;
  });
  const timestamp = parts['t'];
  const hash = parts['v0'];
  if (!timestamp || !hash) return false;
  const body = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
  const payload = `${timestamp}.${body}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
}

function extractClientName(messages) {
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const match = userMessages.match(/(?:my name is|I'm|I am|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
  return match ? match[1] : 'Client';
}

router.post('/', async (req, res) => {
  try {
    if (!verifySignature(req)) {
      console.warn('Webhook: Invalid HMAC signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Acknowledge receipt immediately (ElevenLabs requires 200)
    res.status(200).json({ received: true });

    const { type, data } = req.body;

    // Only process transcription webhooks
    if (type !== 'post_call_transcription' || !data || !data.transcript || !data.transcript.length) {
      return;
    }

    const { conversation_id, transcript } = data;

    // Map ElevenLabs transcript format to our messages format
    const messages = transcript.map(entry => ({
      role: entry.role === 'agent' ? 'assistant' : 'user',
      content: entry.message
    }));

    const userTurns = messages.filter(m => m.role === 'user').length;
    const clientName = extractClientName(messages);

    // Create session in DB with conversation_id for frontend polling
    const sessionId = uuidv4();
    await db.createSession(sessionId);
    await db.updateSession(sessionId, { conversation_id: conversation_id });

    // Build transcript text for PRP generation
    const transcriptText = messages
      .map(m => `${m.role === 'user' ? 'Client' : 'Interviewer'}: ${m.content}`)
      .join('\n\n');

    // Generate both outputs in parallel
    const [briefResult, prpResult] = await Promise.allSettled([
      llm.generatePRP(PRP_SYNTHESIS_PROMPT, [
        { role: 'user', content: transcriptText }
      ]),
      llm.generateDevPRP(PRP_DEVELOPER_PROMPT, [
        { role: 'user', content: transcriptText }
      ])
    ]);

    const markdown = briefResult.status === 'fulfilled' ? briefResult.value : null;
    const prpMarkdown = prpResult.status === 'fulfilled' ? prpResult.value : null;

    if (briefResult.status === 'rejected') {
      console.error('Client brief generation failed:', briefResult.reason.message);
    }
    if (prpResult.status === 'rejected') {
      console.error('Dev PRP generation failed:', prpResult.reason.message);
    }

    // Update session with all data
    await db.updateSession(sessionId, {
      messages: JSON.stringify(messages),
      turn_count: userTurns,
      client_name: clientName,
      is_complete: true,
      completed_at: new Date().toISOString(),
      markdown: markdown,
      prp_markdown: prpMarkdown
    });

    console.log(`Webhook: Session ${sessionId} saved (${userTurns} turns, client: ${clientName})`);
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Don't re-throw — response already sent
  }
});

// Poll for session status by ElevenLabs conversation_id
router.get('/status/:conversationId', async (req, res) => {
  try {
    const session = await db.getSessionByConversationId(req.params.conversationId);

    if (!session) {
      // Webhook hasn't arrived yet — tell client to keep polling
      return res.json({ status: 'processing' });
    }

    if (!session.is_complete) {
      // Session created but LLM generation still running
      return res.json({ status: 'generating' });
    }

    // Ready — return session ID for download
    return res.json({
      status: 'ready',
      sessionId: session.id,
      clientName: session.client_name,
      turnCount: session.turn_count
    });
  } catch (err) {
    console.error('Status poll error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
