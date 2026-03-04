# PRP: Replace Voice Pipeline with ElevenLabs Conversational AI

## Goal

Replace the current high-latency, half-duplex voice pipeline (Web Speech STT → Express API → Claude → Express API → ElevenLabs TTS → play audio) with ElevenLabs Conversational AI — a single bidirectional WebSocket that handles STT + LLM + TTS as one real-time streaming pipeline. Post-call webhooks persist transcripts and trigger PRP generation. The Express backend shrinks to: static files, admin dashboard, signed URL endpoint, and webhook receiver.

## Why

The current pipeline has compounding latency at every hop — each turn requires 4+ network round-trips plus separate STT/TTS processing. It's half-duplex (talk-then-listen), creating an unnatural conversation cadence. ElevenLabs Conversational AI eliminates all of this:
- **Single WebSocket** handles STT → LLM → TTS as a unified stream
- **Bidirectional audio** — true real-time conversation, not turn-based
- **Sub-second latency** — no HTTP round-trips per turn
- **Native interruption support** — users can interrupt the agent mid-sentence
- **Server simplification** — removes 3 API routes and 2 services from the critical path

## What (Scope)

### In Scope
- ElevenLabs Agent creation via CLI with Claude LLM, adapted system prompt, and voice config
- `@elevenlabs/client` SDK integration in frontend (bundled via esbuild)
- Signed URL endpoint for secure WebSocket connections
- Post-call webhook receiver that persists transcripts and triggers PRP generation
- Orb visualizer update to use SDK audio frequency data
- Frontend rewrite to use `Conversation.startSession()` flow
- Text-mode fallback preservation (existing Express-based flow still works)

### Out of Scope
- Modifying admin dashboard (reads from same DB, works as-is)
- Changing database schema (same sessions table)
- Custom voice cloning or voice selection UI
- Real-time transcript streaming to admin (webhook is post-call only)
- Mobile native app
- Multi-agent or multi-language support

## Success Criteria

1. Click "Tap to Begin" → mic permission → real-time bidirectional voice conversation starts within 2 seconds
2. Orb animates reactively during AI speech using SDK's `getOutputByteFrequencyData()`
3. Chat bubbles appear for both user and AI turns via `onMessage` callback
4. User can interrupt the agent mid-sentence (agent stops speaking, starts listening)
5. Conversation ends → webhook fires → session saved to PostgreSQL with full transcript
6. PRP generation triggers automatically from webhook, saves markdown to session
7. Admin dashboard shows the session with transcript + generated PRP (no admin changes needed)
8. Text mode fallback still works when mic is denied (existing Express flow untouched)
9. `npm run build` produces `bundle.js` without errors
10. `npm start` starts server, serves app, handles signed URL and webhook requests

## Existing Codebase Context

### Tech Stack
- **Runtime**: Node.js with Express.js 4.18
- **Frontend**: Vanilla JavaScript (IIFE, no modules), dark-themed mobile-first UI
- **Voice (current)**: ElevenLabs TTS (server-proxied base64 audio) + Web Speech API STT (browser)
- **LLM**: Anthropic Claude via `@anthropic-ai/sdk` (chat model: haiku, PRP model: sonnet)
- **Database**: PostgreSQL via `pg` pool
- **Auth**: Cookie-based admin password
- **Dependencies**: express, dotenv, uuid, @anthropic-ai/sdk, pg, cookie-parser

### Current Architecture
```
Browser (Web Speech STT) → Express API → Anthropic Claude → Express API → ElevenLabs TTS → Browser
```

### Target Architecture
```
Browser ←→ ElevenLabs Conversational AI (WebSocket: STT + Claude LLM + TTS)
                    ↓ (post-call webhook)
              Express server → PostgreSQL
```

### Key Files

| File | Role | Status After Migration |
|------|------|----------------------|
| `server.js` | Express server entry point | MODIFY — mount new routes |
| `package.json` | Dependencies & scripts | MODIFY — add esbuild, @elevenlabs/client, build script |
| `public/index.html` | Main UI | MODIFY — single bundled script tag |
| `public/js/app.js` | Main controller (orchestrates session, voice, UI) | REWRITE — ElevenLabs SDK flow |
| `public/js/voice-engine.js` | Web Speech STT + ElevenLabs TTS proxy | KEEP — text-mode fallback only |
| `public/js/orb-visualizer.js` | Canvas-based animated orb | MODIFY — add `setFrequencyData()` |
| `public/js/ui.js` | DOM manipulation, screen transitions | MINOR EDIT — remove voice-engine callbacks |
| `src/routes/convai.js` | Signed URL endpoint | CREATE |
| `src/routes/webhook.js` | Post-call webhook receiver | CREATE |
| `src/routes/session.js` | Session CRUD + message endpoint | KEEP — text-mode fallback |
| `src/routes/tts.js` | ElevenLabs TTS proxy | KEEP — text-mode fallback |
| `src/routes/admin.js` | Admin dashboard API | NO CHANGE |
| `src/routes/download.js` | Markdown file download | NO CHANGE |
| `src/services/llm.js` | Anthropic SDK wrapper | KEEP — used for PRP generation in webhook |
| `src/services/conversation-engine.js` | LLM conversation orchestration | KEEP — text-mode fallback |
| `src/services/db.js` | PostgreSQL connection & CRUD | NO CHANGE |
| `src/services/session-manager.js` | Session CRUD wrapper | NO CHANGE |
| `src/services/eleven-labs.js` | TTS API wrapper | KEEP — text-mode fallback |
| `src/prompts/system-prompt.js` | Interviewer + PRP synthesis prompts | NO CHANGE (prompt adapted for agent config) |
| `public/css/styles.css` | Styles | NO CHANGE |
| `public/admin.html` | Admin dashboard UI | NO CHANGE |

---

## Implementation Phases

### Phase 1: ElevenLabs Agent Setup via CLI

#### Step 1.1: Install ElevenLabs CLI (if not already installed)

```bash
npm install -g @elevenlabs/cli
elevenlabs auth login
```

**Validation**: `elevenlabs --version` returns version number.

#### Step 1.2: Create Agent Configuration

```bash
cd /Users/david/Documents/GitHub/PRD_generator/voice-intake
elevenlabs agents init
elevenlabs agents add "Voice Intake Interviewer" --template default
```

#### Step 1.3: Configure Agent

Edit the generated agent config JSON to set:

**LLM Configuration**:
- Model: `claude-3-5-sonnet` (or latest Claude model available in ElevenLabs model list)
- Temperature: 0.7

**System Prompt** — Adapt from `src/prompts/system-prompt.js` `INTERVIEWER_PROMPT`, with these modifications:
- **Remove** the JSON response format requirement (ElevenLabs handles text responses natively — the agent speaks the text directly, no JSON wrapping needed)
- **Remove** the `coveredCategories` and `confidence` tracking (agent doesn't need to return structured metadata)
- **Keep** all conversation rules, information targets, and completion rules
- **Add** instruction: "When you have sufficient coverage of at least 6 of the 8 categories and feel confident you could write a solid requirements document, naturally wrap up the conversation by thanking the client warmly and telling them their project brief is being generated."
- **Add** instruction: "Keep responses concise — 1-3 sentences. You are being spoken aloud via TTS, so avoid long paragraphs."

**Adapted system prompt** (to be set in agent config):
```
You are a friendly, warm product intake interviewer. Your job is to understand what a client wants to build through natural conversation. You are NOT technical — you speak in plain language.

## Your Information Targets
You need to gather information across these 8 categories:
1. Vision — What they want to build, the big idea, the name
2. Users — Who will use it, what problem it solves
3. Features — Core capabilities, must-haves
4. Journey — Step-by-step user experience
5. Design — Look, feel, vibe, colors, mood
6. Integrations — External tools, apps, services needed
7. Scale — Expected user count, growth expectations
8. Constraints — Timeline, budget, limitations

## Conversation Rules
- Ask ONE question at a time
- Start with a warm greeting and ask about their vision
- When an answer is vague, dig deeper with a follow-up before moving on
- Follow interesting threads — if they mention something exciting, explore it
- You CAN suggest best practices
- You CAN answer questions about what's possible or common approaches
- Keep questions conversational and non-technical
- Never use jargon — translate technical concepts into plain language
- Acknowledge their answers warmly before asking the next question
- Keep responses concise — 1-3 sentences. You are being spoken aloud.

## Completion Rules
- You need reasonable coverage of at least 6 of the 8 categories
- Maximum 20 turns — if you hit 20, wrap up gracefully
- When complete, thank them warmly and tell them their project brief is being generated
```

**Voice**: Use the existing `ELEVENLABS_VOICE_ID` from `.env`

**First Message**: `"Hi there! I'm excited to learn about your project idea. Let's start simple — what do you want to build? Just describe the big idea in a couple of sentences."`

**Max Duration**: 1800 seconds (30 minutes)

**Post-Call Webhook**: Point to `https://<your-railway-domain>/api/webhook/conversation`
- Type: `post_call_transcription`
- This webhook fires after the call ends and analysis is complete

#### Step 1.4: Push Agent Configuration

```bash
elevenlabs agents push
```

Store the resulting `agent_id` in `.env` as `ELEVENLABS_AGENT_ID`.

**Validation**: `elevenlabs agents list` shows the agent. Test via ElevenLabs dashboard playground.

---

### Phase 2: Build System & Dependencies

#### Step 2.1: Install Dependencies

```bash
cd /Users/david/Documents/GitHub/PRD_generator/voice-intake
npm install @elevenlabs/client
npm install --save-dev esbuild
```

**Validation**: `node -e "require('@elevenlabs/client'); console.log('OK')"`

#### Step 2.2: Update `package.json` — Add Build Scripts

**File**: `package.json`
**Action**: MODIFY

**Changes**:
- Add `@elevenlabs/client` to dependencies
- Add `esbuild` to devDependencies
- Update scripts:

```json
{
  "scripts": {
    "build": "esbuild public/js/app.js --bundle --outfile=public/js/bundle.js --format=iife --platform=browser",
    "dev": "npm run build && node --watch server.js",
    "start": "npm run build && node server.js"
  }
}
```

**Validation**: `npm run build` produces `public/js/bundle.js` without errors.

#### Step 2.3: Update `public/index.html` — Single Bundle Script

**File**: `public/index.html`
**Action**: MODIFY

**Replace** the 4 script tags at the bottom:
```html
<script src="/js/orb-visualizer.js"></script>
<script src="/js/voice-engine.js"></script>
<script src="/js/ui.js"></script>
<script src="/js/app.js"></script>
```

**With** a single bundled script:
```html
<script src="/js/bundle.js"></script>
```

**Everything else in `index.html` stays the same** — same HTML structure, same IDs, same screens, same orb canvas, same chat container.

**Validation**: After build, `public/js/bundle.js` exists and contains all 4 modules.

---

### Phase 3: Signed URL Endpoint

#### Step 3.1: Create `src/routes/convai.js`

**File**: `src/routes/convai.js`
**Action**: CREATE

**Requirements**:
- Single GET endpoint: `/api/convai/signed-url`
- Calls ElevenLabs API to get a signed WebSocket URL for the agent
- Returns `{ signed_url }` to the client

**Implementation**:
```javascript
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
```

**Validation**: `curl http://localhost:3000/api/convai/signed-url` returns `{ "signed_url": "wss://..." }` (requires valid API key and agent ID).

---

### Phase 4: Post-Call Webhook Endpoint

#### Step 4.1: Create `src/routes/webhook.js`

**File**: `src/routes/webhook.js`
**Action**: CREATE

**Requirements**:
- POST endpoint: `/api/webhook/conversation`
- Receives ElevenLabs post-call transcription webhook payload
- Extracts conversation data from the webhook
- Creates a new session in PostgreSQL with the transcript
- Triggers PRP generation via `llm.generatePRP()`
- Saves generated markdown to the session
- Marks session as complete
- Returns 200 status (required by ElevenLabs)

**Webhook Payload** (post_call_transcription type — key fields):

The payload is wrapped in a `type` + `data` envelope. The `data` object matches the `GetConversationResponseModel` (same schema as the GET Conversation Details API).

```json
{
  "type": "post_call_transcription",
  "data": {
    "agent_id": "agent_xxx",
    "agent_name": "Voice Intake Interviewer",
    "conversation_id": "conv_xxx",
    "status": "done",
    "has_audio": true,
    "has_user_audio": true,
    "has_response_audio": true,
    "transcript": [
      {
        "role": "agent",
        "message": "Hi there! I'm excited to learn about your project idea...",
        "time_in_call_secs": 0.5,
        "interrupted": false
      },
      {
        "role": "user",
        "message": "I want to build a dog walking app called PawWalk",
        "time_in_call_secs": 4.2,
        "source_medium": "audio"
      }
    ],
    "metadata": {
      "start_time_unix_secs": 1709500000,
      "call_duration_secs": 420,
      "text_only": false,
      "termination_reason": "agent_ended",
      "authorization_method": "signed_url",
      "conversation_initiation_source": "js_sdk"
    },
    "analysis": {
      "call_successful": "success",
      "transcript_summary": "Client wants to build a dog walking app...",
      "evaluation_criteria_results": {},
      "data_collection_results": {}
    },
    "conversation_initiation_client_data": {
      "conversation_config_override": {}
    }
  }
}
```

**Important**: Webhooks require a 200 status response. They auto-disable after 10+ consecutive failures if last success was 7+ days ago. HMAC signature verification is available via the `ElevenLabs-Signature` header.

**Implementation**:
```javascript
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
```

**Key Design Decisions**:
1. **Respond immediately with 200**, then process async — ElevenLabs requires a 200 response, and PRP generation may take several seconds
2. **Create a new session** per webhook call — the conversation happened entirely within ElevenLabs, so there's no pre-existing session
3. **Use `conversation_id` from ElevenLabs** as metadata but generate our own UUID for the session ID to match existing DB schema
4. **Reuse `extractClientName`** logic from `conversation-engine.js` — same regex pattern
5. **Reuse `llm.generatePRP`** with the same `PRP_SYNTHESIS_PROMPT` — consistent PRP output format

**Validation**:
```bash
curl -X POST http://localhost:3000/api/webhook/conversation \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "post_call_transcription",
    "data": {
      "conversation_id": "test_123",
      "agent_id": "agent_xxx",
      "status": "done",
      "transcript": [
        {"role": "agent", "message": "Hi! What do you want to build?", "time_in_call_secs": 0.5, "interrupted": false},
        {"role": "user", "message": "I am David and I want to build a task management app", "time_in_call_secs": 3.0, "source_medium": "audio"}
      ],
      "metadata": {"call_duration_secs": 120, "text_only": false, "termination_reason": "agent_ended"},
      "analysis": {"call_successful": "success", "transcript_summary": "Client wants a task management app"}
    }
  }'
```
Expected: 200 response, session created in DB, PRP generated.

---

### Phase 5: Mount New Routes in Server

#### Step 5.1: Update `server.js`

**File**: `server.js`
**Action**: MODIFY

**Add imports** (after existing route imports):
```javascript
const convaiRoutes = require('./src/routes/convai');
const webhookRoutes = require('./src/routes/webhook');
```

**Mount routes** (after existing `app.use` lines):
```javascript
app.use('/api/convai', convaiRoutes);
app.use('/api/webhook', webhookRoutes);
```

**Add startup check** (in the listen callback):
```javascript
if (!process.env.ELEVENLABS_AGENT_ID) {
  console.warn('⚠  ELEVENLABS_AGENT_ID not set — ConvAI mode disabled');
}
```

**Everything else in `server.js` stays the same.**

**Validation**: `npm start` logs "Voice Intake running" with no errors. New routes respond.

---

### Phase 6: Rewrite Frontend — ElevenLabs SDK Integration

#### Step 6.1: Rewrite `public/js/app.js`

**File**: `public/js/app.js`
**Action**: REWRITE

This is the core change. The app switches from the VoiceEngine + Express API flow to ElevenLabs Conversation SDK.

**New structure**:
```javascript
import { Conversation } from '@elevenlabs/client';

// Import existing modules (they'll be bundled)
// OrbVisualizer and UI are loaded as globals from their respective files
// which are also imported into the bundle

(function () {
  const ui = new UI();

  // State
  let conversation = null;  // ElevenLabs Conversation instance
  let isConvAIMode = true;  // true = ElevenLabs ConvAI, false = text fallback
  let sessionEnded = false;

  // ===== Element Bindings =====
  document.getElementById('btn-start').addEventListener('click', startSession);
  document.getElementById('btn-submit-text').addEventListener('click', submitText);
  document.getElementById('btn-mode-toggle').addEventListener('click', toggleMode);
  document.getElementById('btn-download').addEventListener('click', downloadBrief);

  // ===== ConvAI Session =====
  async function startSession() {
    ui.showScreen('question');
    ui.setOrbThinking();

    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('Mic denied, falling back to text mode');
      isConvAIMode = false;
      await startTextSession();
      return;
    }

    try {
      // Fetch signed URL from our backend
      const res = await fetch('/api/convai/signed-url');
      const { signed_url } = await res.json();

      if (!signed_url) {
        throw new Error('No signed URL returned');
      }

      // Start ElevenLabs Conversation session
      conversation = await Conversation.startSession({
        signedUrl: signed_url,

        onConnect: () => {
          console.log('ConvAI connected');
          ui.visualizer.setState('listening');
          ui.voiceLabel.textContent = 'Listening...';
          startOrbAnimation();
        },

        onDisconnect: (reason) => {
          // Note: SDK v3.0.0+ passes disconnect reason parameter
          console.log('ConvAI disconnected, reason:', reason);
          if (!sessionEnded) {
            sessionEnded = true;
            showSummary();
          }
        },

        onMessage: ({ source, message }) => {
          // source: 'user' or 'ai'
          const role = source === 'user' ? 'user' : 'assistant';
          ui.addChatMessage(role, message);
        },

        onModeChange: ({ mode }) => {
          // mode: 'speaking' or 'listening'
          if (mode === 'speaking') {
            ui.visualizer.setState('speaking');
            ui.voiceLabel.textContent = 'Speaking...';
          } else {
            ui.visualizer.setState('listening');
            ui.voiceLabel.textContent = 'Listening...';
          }
        },

        onError: (error) => {
          console.error('ConvAI error:', error);
          ui.toast('Voice error. Switching to text mode.');
          isConvAIMode = false;
          ui.showTextMode();
        }
      });
    } catch (err) {
      console.error('Failed to start ConvAI session:', err);
      ui.toast('Voice connection failed. Switching to text mode.');
      isConvAIMode = false;
      await startTextSession();
    }
  }

  // ===== Orb Animation with SDK Audio Data =====
  let animFrameId = null;

  function startOrbAnimation() {
    function animate() {
      if (conversation && ui.visualizer.state === 'speaking') {
        const freqData = conversation.getOutputByteFrequencyData();
        if (freqData) {
          ui.visualizer.setFrequencyData(freqData);
        }
      }
      animFrameId = requestAnimationFrame(animate);
    }
    animate();
  }

  function stopOrbAnimation() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // ===== Text Mode Fallback =====
  // Uses existing Express-based conversation flow (POST /api/session endpoints)
  let fallbackVoice = null;
  let fallbackSessionId = null;

  async function startTextSession() {
    ui.showScreen('question');
    ui.setOrbThinking();

    try {
      // Lazy-load VoiceEngine for text mode
      if (!fallbackVoice) {
        fallbackVoice = new VoiceEngine();
      }

      const res = await fetch('/api/session', { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.sessionId || !data.message) {
        throw new Error(data.error || 'Invalid session response');
      }

      fallbackSessionId = data.sessionId;
      ui.addChatMessage('assistant', data.message);
      ui.showTextMode();
    } catch (err) {
      ui.toast('Failed to start session. Please refresh.');
      ui.showScreen('welcome');
      console.error(err);
    }
  }

  async function submitText() {
    const text = ui.textInput.value.trim();
    if (!text) { ui.toast('Please type a message first.'); return; }
    ui.textInput.value = '';

    if (isConvAIMode) {
      // If somehow in text submit while ConvAI is active, ignore
      return;
    }

    // Text-mode fallback: use existing Express API
    ui.addChatMessage('user', text);
    ui.setOrbThinking();

    try {
      const res = await fetch(`/api/session/${fallbackSessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();

      if (!res.ok || !data.message) {
        throw new Error(data.error || 'Failed to get response');
      }

      ui.addChatMessage('assistant', data.message);

      if (data.isComplete) {
        showSummary();
      } else {
        ui.showTextMode();
      }
    } catch (err) {
      ui.toast('Network error. Please try again.');
      console.error(err);
      ui.showTextMode();
    }
  }

  function toggleMode() {
    if (isConvAIMode && conversation) {
      // End ConvAI session, switch to text
      conversation.endSession();
      conversation = null;
      isConvAIMode = false;
      stopOrbAnimation();
      startTextSession();
    } else {
      // Already in text mode — no switch back to ConvAI mid-session
      ui.toast('Voice mode is only available at session start.');
    }
  }

  // ===== Summary & Download =====
  function showSummary() {
    stopOrbAnimation();
    ui.buildSummary();
    ui.showScreen('summary');
  }

  function downloadBrief() {
    if (fallbackSessionId) {
      // Text-mode: download from existing endpoint
      window.location.href = `/api/download/${fallbackSessionId}`;
    } else {
      // ConvAI mode: brief is generated async via webhook
      // Show message that brief will be available in admin dashboard
      ui.toast('Your brief is being generated. Check the admin dashboard shortly.');
    }
  }
})();
```

**Key differences from current `app.js`**:

| Current | New |
|---------|-----|
| `new VoiceEngine()` on startup | `Conversation.startSession()` on user click |
| `voice.speak(message)` per turn | Agent speaks automatically via WebSocket |
| `voice.startListening()` per turn | Agent listens automatically via WebSocket |
| `fetch('/api/session/:id/message')` per turn | No HTTP per turn — all via WebSocket |
| `voice.onAudioCreated` → `connectAudio` | `conversation.getOutputByteFrequencyData()` in animation loop |
| Session ID managed client-side | Session created server-side via webhook post-call |

**Validation**: `npm run build` compiles without errors. Browser test: click Begin, mic prompt, voice conversation starts.

#### Step 6.2: Update `public/js/orb-visualizer.js` — Add Frequency Data Method

**File**: `public/js/orb-visualizer.js`
**Action**: MODIFY

**Add a new method** `setFrequencyData(data)` that accepts a `Uint8Array` from the SDK's `getOutputByteFrequencyData()`:

```javascript
/** Accept frequency data from ElevenLabs SDK */
setFrequencyData(data) {
  this._sdkFreqData = data;
}
```

**Modify** the `_getLevel()` method to check for SDK frequency data first:

```javascript
_getLevel() {
  // Priority 1: ElevenLabs SDK frequency data
  if (this._sdkFreqData && this._sdkFreqData.length > 0) {
    let sum = 0;
    for (let i = 0; i < this._sdkFreqData.length; i++) {
      sum += this._sdkFreqData[i];
    }
    const level = sum / (this._sdkFreqData.length * 255);
    this._sdkFreqData = null; // Consume once
    return level;
  }

  // Priority 2: AudioContext analyser (existing audio element connection)
  if (this.analyser && this.freqData) {
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      sum += this.freqData[i];
    }
    return sum / (this.freqData.length * 255);
  }

  // Priority 3: Simulated speaking (browser TTS fallback)
  if (this._simulated) {
    this._simPhase += 0.08;
    return 0.3 + 0.3 * Math.sin(this._simPhase) + 0.1 * Math.sin(this._simPhase * 2.7);
  }

  return 0;
}
```

**Add** `_sdkFreqData` initialization in constructor:
```javascript
this._sdkFreqData = null;
```

**Validation**: Orb responds to SDK audio data during ConvAI speaking. Falls back to existing behavior for text mode.

#### Step 6.3: Update `public/js/ui.js` — Minor Cleanup

**File**: `public/js/ui.js`
**Action**: MINOR EDIT

**Changes**:
- The `setOrbThinking` method currently sets `this.voiceOrb.className = 'voice-orb'` — this is correct and doesn't need change
- No other changes needed — `addChatMessage`, `showScreen`, `setOrbSpeaking`, `setOrbListening`, `buildSummary`, `toast`, `showTextMode` all work as-is
- The `showConfirm` method is no longer called in ConvAI mode but doesn't need removal (harmless, and still used if text-mode fallback shows it)

**Validation**: UI works identically for both ConvAI and text-mode paths.

---

### Phase 7: Update Environment Variables

#### Step 7.1: Update `.env.example`

**File**: `.env.example` (or `.env`)
**Action**: MODIFY

**Add**:
```
ELEVENLABS_AGENT_ID=your_agent_id_here
```

**Keep existing** (all still used):
```
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here  # Now configured in agent, but kept for text-mode TTS fallback
ANTHROPIC_API_KEY=your_anthropic_api_key_here  # Still used for PRP generation in webhook
PRP_MODEL=claude-sonnet-4-5-20250929  # PRP synthesis model
LLM_MODEL=claude-haiku-4-5-20251001  # Chat model for text-mode fallback
DATABASE_URL=postgresql://...
ADMIN_PASSWORD=...
PORT=3000
```

---

## Files Changed Summary

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `package.json` | MODIFY | 2 | Add `@elevenlabs/client`, `esbuild` devDep, build scripts |
| `.env.example` | MODIFY | 7 | Add `ELEVENLABS_AGENT_ID` |
| `public/index.html` | MODIFY | 2 | Single `<script src="/js/bundle.js">` replacing 4 script tags |
| `public/js/app.js` | REWRITE | 6 | ElevenLabs SDK `Conversation.startSession()` flow |
| `public/js/orb-visualizer.js` | MODIFY | 6 | Add `setFrequencyData()`, update `_getLevel()` priority |
| `public/js/ui.js` | MINOR EDIT | 6 | Remove voice-engine-specific callback setup (if any) |
| `public/js/voice-engine.js` | KEEP | — | Text-mode fallback only |
| `src/routes/convai.js` | CREATE | 3 | `GET /api/convai/signed-url` endpoint |
| `src/routes/webhook.js` | CREATE | 4 | `POST /api/webhook/conversation` receiver |
| `server.js` | MODIFY | 5 | Mount convai + webhook routes, add AGENT_ID check |
| `src/services/eleven-labs.js` | FIX | 2 | Update deprecated `eleven_monolingual_v1` → `eleven_turbo_v2_5` |

**Files NOT changed** (11 files):
- `public/css/styles.css` — no style changes needed
- `public/admin.html` — admin dashboard works as-is
- `src/routes/admin.js` — reads from same DB
- `src/routes/download.js` — download works as-is
- `src/routes/session.js` — text-mode fallback
- `src/routes/tts.js` — text-mode fallback
- `src/services/conversation-engine.js` — text-mode fallback
- `src/services/db.js` — same schema, same operations
- `src/services/session-manager.js` — same interface
- `src/services/llm.js` — still used for PRP generation in webhook
- `src/prompts/system-prompt.js` — PRP synthesis prompt reused in webhook

---

## Verification Plan

### Phase 1 Verification (Agent Setup)
```bash
# Agent exists and is configured
elevenlabs agents list
# Test agent in ElevenLabs dashboard playground
```

### Phase 2 Verification (Build System)
```bash
# Bundle builds without errors
npm run build
ls -la public/js/bundle.js

# Server starts cleanly
npm start
```

### Phase 3 Verification (Signed URL)
```bash
# Signed URL endpoint works
curl -s http://localhost:3000/api/convai/signed-url | jq .
# Expected: { "signed_url": "wss://..." }
```

### Phase 4 Verification (Webhook)
```bash
# Simulate webhook call
curl -s -X POST http://localhost:3000/api/webhook/conversation \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "post_call_transcription",
    "data": {
      "conversation_id": "test_verify",
      "agent_id": "agent_xxx",
      "status": "done",
      "transcript": [
        {"role": "agent", "message": "Hi! What do you want to build?", "time_in_call_secs": 0.5},
        {"role": "user", "message": "My name is David. I want to build a project management tool for small teams.", "time_in_call_secs": 4.0},
        {"role": "agent", "message": "That sounds great, David! Tell me more about who would use it.", "time_in_call_secs": 8.0},
        {"role": "user", "message": "Small startup teams of 5-15 people who need simple task tracking.", "time_in_call_secs": 12.0}
      ],
      "metadata": {"call_duration_secs": 300, "text_only": false, "termination_reason": "agent_ended"},
      "analysis": {"call_successful": "success", "transcript_summary": "Project management tool discussion"}
    }
  }'
# Expected: { "received": true }
# Then check DB: session exists with messages, client_name="David", markdown generated
```

### Phase 5-6 Verification (Full E2E)
1. Open browser to `http://localhost:3000`
2. Click "Tap to Begin"
3. Grant microphone permission
4. **Verify**: Orb shows listening state, real-time voice conversation starts
5. Speak naturally — agent responds via voice
6. **Verify**: Chat bubbles appear for both user and AI turns
7. **Verify**: Orb animates reactively during AI speech
8. **Verify**: Can interrupt agent mid-sentence
9. Conversation ends naturally (agent wraps up)
10. **Verify**: Summary screen appears with download option
11. **Verify**: Check admin dashboard — session appears with transcript + PRP
12. **Verify**: Text mode fallback — deny mic permission, conversation works via typing

### Phase 7 Verification (Deployment)
```bash
# Deploy to Railway
railway up

# Set webhook URL in ElevenLabs agent config to Railway domain
elevenlabs agents push

# Test full flow on deployed URL
```

---

## Error Handling & Edge Cases

1. **Microphone denied**: Fall back to text mode immediately. User sees text input, existing Express-based conversation flow handles everything.
2. **Signed URL fetch fails**: Toast error, fall back to text mode. Log error server-side.
3. **WebSocket disconnects unexpectedly**: `onDisconnect` fires → show summary screen. Webhook may or may not fire depending on disconnect timing. If no webhook, no PRP is generated — user sees message to check admin dashboard.
4. **Webhook processing fails**: Response already sent (200). Log error. Session may be partially saved. Admin can see incomplete sessions.
5. **PRP generation fails in webhook**: Session saved without markdown. Admin can trigger regeneration manually (future enhancement) or download raw transcript.
6. **Agent hits max duration (30 min)**: ElevenLabs disconnects automatically. Webhook fires with whatever was discussed. PRP generated from available transcript.
7. **Browser doesn't support WebRTC/WebSocket**: Fall back to text mode. The `@elevenlabs/client` SDK will throw on `startSession()`.
8. **Concurrent sessions**: Each browser session gets its own WebSocket and conversation. No server-side session state needed during the call.
9. **Webhook replay/duplicate**: Use `conversation_id` from payload to check for existing sessions. Skip if already processed. (Enhancement: add `conversation_id` column to sessions table.)

---

## Critical Notes & SDK Details

### Package Migration
- The old `@11labs/client` package is **deprecated and no longer maintained**
- Use `@elevenlabs/client` (current version ~0.15.0 as of March 2026)
- Import: `import { Conversation } from '@elevenlabs/client'`

### SDK v3.0.0 Breaking Changes
- `onDisconnect` callback now receives a **disconnect reason** parameter
- Added `.thinking` agent state
- Updated LiveKit to 2.10.0+

### TTS Model Deprecation (December 15, 2025)
- `eleven_monolingual_v1` and `eleven_multilingual_v1` are **removed**
- The existing `src/services/eleven-labs.js` uses `eleven_monolingual_v1` — **must update** to `eleven_turbo_v2_5` or newer for text-mode TTS fallback
- ConvAI agent uses its own TTS model (configured in agent settings, not affected)

### Signed URL Details
- Signed URL is valid for **15 minutes** (conversation can last longer, just must initiate within window)
- Endpoint: `GET https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id={id}`
- Header: `xi-api-key: {ELEVENLABS_API_KEY}`

### Available Claude Models in ElevenLabs
- Claude Sonnet 4.5
- Claude Sonnet 4
- Claude Haiku 4.5
- Claude 3.7 Sonnet
- Claude 3.5 Sonnet
- Claude 3 Haiku

### Conversation Instance Methods (Available After `startSession`)
- `endSession()` — terminates the conversation
- `getId()` — returns conversation ID
- `setVolume({ volume })` — set output volume (0.0-1.0)
- `getInputByteFrequencyData()` — raw input audio frequency data (Uint8Array)
- `getOutputByteFrequencyData()` — raw output audio frequency data (Uint8Array)
- `sendContextualUpdate(text)` — inform agent of non-conversation events
- `sendUserMessage(text)` — send text message to agent
- `setMicMuted(muted)` — mute/unmute microphone

### Webhook Security
- HMAC signature verification via `ElevenLabs-Signature` header
- Auto-disabled after 10+ consecutive failures if last success was 7+ days ago

### Session Overrides (Can Be Passed at `startSession`)
```javascript
overrides: {
  agent: {
    firstMessage: 'Custom greeting...',
    language: 'en',
    prompt: {
      prompt: 'Custom system prompt...',
      llm: 'claude-sonnet-4-5'
    }
  },
  tts: {
    voice_id: 'xxx',
    stability: 0.5,
    speed: 1.0,
    similarity_boost: 0.75
  },
  conversation: {
    max_duration_seconds: 1800
  }
}
```

## Dependencies to Install

```bash
# Production
npm install @elevenlabs/client

# Development
npm install --save-dev esbuild
```

Total new dependencies: 2 (1 production, 1 dev)

### Existing Dependency Fix Required
**Update `src/services/eleven-labs.js`**: Change `model_id` from `'eleven_monolingual_v1'` to `'eleven_turbo_v2_5'` (the old model was removed December 15, 2025). This only affects the text-mode TTS fallback.

---

## Migration Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| ElevenLabs SDK breaking changes | High | Pin `@elevenlabs/client` version in package.json |
| Webhook delivery failures | Medium | Log all webhook payloads, add retry endpoint in admin |
| Browser compatibility | Low | Text-mode fallback covers all browsers |
| Agent system prompt tuning | Low | Iterate via ElevenLabs dashboard, no code changes needed |
| Latency of PRP generation | Low | Async processing — user sees summary immediately, PRP appears in admin shortly |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Browser                           │
│                                                     │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │ Orb Canvas  │◄───│ app.js (bundled)          │   │
│  │ Visualizer  │    │                           │   │
│  └─────────────┘    │  Conversation.startSession│   │
│                     │  onMessage → chat bubbles  │   │
│                     │  onModeChange → orb state   │   │
│                     │  getOutputByteFrequency... │   │
│                     └──────────┬─────────────────┘   │
│                                │ WebSocket            │
└────────────────────────────────┼─────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  ElevenLabs ConvAI      │
                    │  (STT + Claude + TTS)   │
                    │                         │
                    │  Agent: Voice Intake     │
                    │  LLM: Claude Sonnet     │
                    │  Voice: configured      │
                    └────────────┬────────────┘
                                 │ POST webhook
                    ┌────────────▼────────────┐
                    │  Express Server          │
                    │                         │
                    │  /api/convai/signed-url  │
                    │  /api/webhook/convo      │
                    │  /api/admin/* (existing) │
                    │  /api/session/* (fallback)│
                    │  /api/tts (fallback)     │
                    │  /api/download (existing)│
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  PostgreSQL (Railway)    │
                    │  sessions table          │
                    │  (same schema)           │
                    └─────────────────────────┘
```

---

*Generated by Claude — 2026-03-03*
