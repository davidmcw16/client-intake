const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../services/db');
const llm = require('../services/llm');
const { PRP_SYNTHESIS_PROMPT } = require('../prompts/system-prompt');

function extractClientName(messages) {
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const match = userMessages.match(/(?:my name is|I'm|I am|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
  return match ? match[1] : 'Client';
}

router.post('/conversation', async (req, res) => {
  try {
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

    // Create session in DB
    const sessionId = uuidv4();
    await db.createSession(sessionId);

    // Build transcript text for PRP generation
    const transcriptText = messages
      .map(m => `${m.role === 'user' ? 'Client' : 'Interviewer'}: ${m.content}`)
      .join('\n\n');

    // Generate PRP from transcript
    let markdown = null;
    try {
      markdown = await llm.generatePRP(PRP_SYNTHESIS_PROMPT, [
        { role: 'user', content: transcriptText }
      ]);
    } catch (err) {
      console.error('PRP generation failed:', err.message);
    }

    // Update session with all data
    await db.updateSession(sessionId, {
      messages: JSON.stringify(messages),
      turn_count: userTurns,
      client_name: clientName,
      is_complete: true,
      completed_at: new Date().toISOString(),
      markdown: markdown
    });

    console.log(`Webhook: Session ${sessionId} saved (${userTurns} turns, client: ${clientName})`);
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Don't re-throw — response already sent
  }
});

module.exports = router;
