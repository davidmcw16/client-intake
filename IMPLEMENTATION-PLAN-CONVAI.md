# Plan: Replace Voice Pipeline with ElevenLabs Conversational AI

## Context

The current voice-intake app has a high-latency pipeline: Web Speech API STT → POST to backend → Claude API call → response → POST to TTS → play audio. Each step adds latency, and it's half-duplex (talk-then-listen, not bidirectional).

**Goal:** Replace the entire voice pipeline with ElevenLabs Conversational AI, which handles STT → LLM → TTS as one real-time streaming pipeline with bidirectional audio. Keep the existing UI (animated orb, chat bubbles, admin dashboard).

---

## Architecture Change

**Before:**
```
Browser (Web Speech STT) → Express API → Anthropic Claude → Express API → ElevenLabs TTS → Browser
```

**After:**
```
Browser ←→ ElevenLabs Conversational AI (handles STT + Claude LLM + TTS)
                    ↓ (post-call webhook)
              Express server → PostgreSQL
```

The Express server shrinks to: serving static files, admin dashboard, signed URL endpoint, and webhook receiver.

---

## Step 1: Set Up ElevenLabs Agent via CLI

Install CLI and create agent config:

```bash
npm install -g @elevenlabs/cli
elevenlabs auth login
elevenlabs agents init
elevenlabs agents add "Voice Intake Interviewer" --template default
```

Edit the generated agent config JSON to set:
- **LLM**: `claude-3-5-sonnet` (or `claude-sonnet-4-5-20250929` if available in their model list)
- **System prompt**: Adapt `INTERVIEWER_PROMPT` from `src/prompts/system-prompt.js` — remove the JSON response format requirement (ElevenLabs handles text responses natively, no JSON wrapping needed)
- **Voice**: Use existing `ELEVENLABS_VOICE_ID`
- **First message**: The interviewer greeting
- **Max duration**: 1800 seconds (30 min)
- **Post-call webhook**: Point to `https://<your-railway-domain>/api/webhook/conversation`

Then push: `elevenlabs agents push`

Store the resulting `agent_id` in `.env` as `ELEVENLABS_AGENT_ID`.

---

## Step 2: Add esbuild + Bundle Frontend

**Install:** `npm install --save-dev esbuild`

**Add to `package.json` scripts:**
```json
"build": "esbuild public/js/app.js --bundle --outfile=public/js/bundle.js --format=iife --platform=browser",
"dev": "npm run build && node --watch server.js",
"start": "npm run build && node server.js"
```

**Install ElevenLabs client:** `npm install @elevenlabs/client`

**Modify `public/index.html`:**
- Replace the 4 script tags with single `<script src="/js/bundle.js"></script>`

---

## Step 3: Add Signed URL Endpoint

**Create: `src/routes/convai.js`**

```
GET /api/convai/signed-url
```
- Calls ElevenLabs API: `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id={ELEVENLABS_AGENT_ID}`
- Headers: `xi-api-key: {ELEVENLABS_API_KEY}`
- Returns `{ signed_url }` to the client

---

## Step 4: Add Post-Call Webhook Endpoint

**Create: `src/routes/webhook.js`**

```
POST /api/webhook/conversation
```
- Receives ElevenLabs post-call transcription webhook payload
- Extracts: `conversation_id`, `transcript` (array of `{role, message, time_in_call_secs}`), `metadata`
- Maps transcript to our messages format: `[{role: 'user'|'assistant', content}]`
- Extracts client name from user messages (reuse `extractClientName` from conversation-engine.js)
- Counts turns (user messages)
- Creates a new session in PostgreSQL with the transcript data
- Triggers PRP generation via `llm.generatePRP()` using the transcript
- Saves the generated markdown to the session
- Marks session as complete

This replaces the entire conversation-engine flow for voice sessions.

---

## Step 5: Rewrite Frontend (`public/js/app.js`)

**Replace VoiceEngine with ElevenLabs SDK:**

```javascript
import { Conversation } from '@elevenlabs/client';
```

**New flow:**
1. User clicks "Tap to Begin"
2. Request mic permission: `navigator.mediaDevices.getUserMedia({ audio: true })`
3. Fetch signed URL from `/api/convai/signed-url`
4. Start conversation: `Conversation.startSession({ signedUrl, onModeChange, onMessage, onConnect, onDisconnect, onError })`
5. `onMessage` callback → add chat bubbles (user transcript + agent response)
6. `onModeChange` callback → drive orb visualizer (`speaking` / `listening`)
7. On disconnect → show summary screen with download button

**Key callbacks:**
- `onModeChange({ mode })` → `ui.visualizer.setState(mode === 'speaking' ? 'speaking' : 'listening')`
- `onMessage({ source, message })` → `ui.addChatMessage(source === 'user' ? 'user' : 'assistant', message)`
- `onConnect` → set orb to listening
- `onDisconnect` → show summary (conversation saved via webhook)
- `onError` → toast + fallback to text mode

**Drive orb with real audio data:**
- In the animation loop, call `conversation.getOutputByteFrequencyData()` to get the agent's audio frequency data
- Feed into `OrbVisualizer` instead of the current AudioContext approach

**Keep text mode fallback:** For browsers without mic support, keep the existing Express-based conversation flow (POST /api/session endpoints still work).

---

## Step 6: Update Orb Visualizer

**Modify: `public/js/orb-visualizer.js`**

Add a `setFrequencyData(data)` method that accepts a `Uint8Array` from the SDK's `getOutputByteFrequencyData()`. The `_getLevel()` method checks for this data first before falling back to AudioContext analyser.

---

## Step 7: Simplify Backend (Remove Unused Routes)

Keep but don't modify:
- `src/routes/admin.js` — admin dashboard (still reads from same DB)
- `src/routes/download.js` — markdown download
- `src/services/db.js` — database operations
- `src/services/session-manager.js` — session CRUD
- `src/services/llm.js` — still used for PRP generation in webhook

Keep but make optional:
- `src/routes/session.js` — text-mode fallback
- `src/routes/tts.js` — text-mode fallback
- `src/services/conversation-engine.js` — text-mode fallback

---

## Step 8: Update Environment Variables

**Add to `.env.example`:**
```
ELEVENLABS_AGENT_ID=your_agent_id_here
```

**Keep existing:**
```
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here  # Now configured in agent, but kept for text-mode TTS fallback
ANTHROPIC_API_KEY=your_anthropic_api_key_here  # Still used for PRP generation
PRP_MODEL=claude-sonnet-4-5-20250929  # PRP synthesis model
DATABASE_URL=postgresql://...
ADMIN_PASSWORD=...
```

---

## Files Changed Summary

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add esbuild, @elevenlabs/client deps + build script |
| `.env.example` | Modify | Add ELEVENLABS_AGENT_ID |
| `public/index.html` | Modify | Single bundled script tag |
| `public/js/app.js` | Rewrite | ElevenLabs SDK integration |
| `public/js/voice-engine.js` | Keep | Text-mode fallback only |
| `public/js/orb-visualizer.js` | Modify | Add setFrequencyData() method |
| `public/js/ui.js` | Minor edit | Remove voice-engine-specific callbacks |
| `src/routes/convai.js` | Create | Signed URL endpoint |
| `src/routes/webhook.js` | Create | Post-call webhook receiver |
| `server.js` | Modify | Mount new routes |

---

## Verification

1. `elevenlabs agents push` → agent created in ElevenLabs
2. `npm run build` → bundle.js generated without errors
3. `npm start` → server starts, serves app
4. Click "Tap to Begin" → mic permission → real-time voice conversation starts
5. Orb animates reactively during AI speech
6. Chat bubbles appear for both user and AI turns
7. Conversation ends → webhook fires → session saved to DB with PRP
8. Admin dashboard shows the session with transcript + generated PRP
9. Text mode fallback still works when mic denied
