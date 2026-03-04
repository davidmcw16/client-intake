# PRP: Transform Voice Intake into LLM-Driven Conversational Platform

## Goal

Transform the existing voice-intake app from a linear 8-question hardcoded flow into an LLM-centric conversational platform where Claude (Anthropic API) drives adaptive interviews, asks contextual follow-ups, suggests best practices, and generates detailed PRP documents. Add PostgreSQL persistence (Railway) and a password-protected admin dashboard.

## Why

The current fixed-question flow produces shallow, template-driven intake briefs. An LLM-driven conversation extracts significantly richer requirements by:
- Adapting follow-up questions based on what the client actually says
- Probing vague answers for specifics
- Suggesting phased approaches and best practices in real-time
- Synthesizing spoken language into polished, structured PRPs
- Persisting all sessions for the product owner to review via admin dashboard

## What (Scope)

### In Scope
- Anthropic Claude API integration for conversation orchestration
- Adaptive interviewer system prompt with 8 coverage categories
- LLM-synthesized PRP markdown generation
- PostgreSQL database (Railway) replacing in-memory session storage
- Password-protected admin dashboard (view/download completed intakes)
- Chat-style UI replacing question/answer flow
- "Thinking" orb state during LLM processing

### Out of Scope
- User authentication beyond admin password
- Multi-tenant / team features
- File uploads or image support
- Real-time streaming of LLM responses
- Custom voice cloning
- Mobile native app

## Success Criteria

1. `POST /api/session` returns a Claude-generated greeting within 3 seconds
2. Claude adaptively follows up on vague answers — never asks the same question twice
3. Conversation completes in 8-20 turns with coverage across all 8 categories
4. Generated PRP markdown contains all required sections (Goal, Users, Features, Journey, Design, Dependencies, Scale, Constraints)
5. Sessions persist in PostgreSQL and survive server restarts
6. Admin dashboard shows all completed sessions with download capability
7. Voice flow works end-to-end: speak → Claude responds → TTS speaks response → listen again
8. Text fallback mode works identically to voice mode

## Existing Codebase Context

### Tech Stack
- **Runtime**: Node.js with Express.js 4.18
- **Frontend**: Vanilla JavaScript (no framework), dark-themed mobile-first UI
- **Voice**: ElevenLabs TTS (server-proxied) + Web Speech API STT (browser)
- **State**: In-memory Map (to be replaced with PostgreSQL)
- **Dependencies**: express, dotenv, uuid

### Current Architecture
```
server.js → routes (session, tts, download) → services (session-manager, eleven-labs, markdown-builder)
public/ → index.html, css/styles.css, js/(app.js, ui.js, voice-engine.js)
```

### Files That Will NOT Change
- `src/services/eleven-labs.js` — TTS API wrapper works as-is
- `src/routes/tts.js` — TTS endpoint works as-is
- `public/js/voice-engine.js` — Voice I/O abstraction works as-is

---

## Implementation Phases

### Phase 1: Dependencies & Database Setup

#### Step 1.1: Install Dependencies

```bash
cd /Users/david/Documents/GitHub/PRD_generator/voice-intake
npm install @anthropic-ai/sdk pg
```

**Validation**: `node -e "require('@anthropic-ai/sdk'); require('pg'); console.log('OK')"`

#### Step 1.2: Update `.env.example`

**File**: `.env.example`
**Action**: MODIFY — add new environment variables

```
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
LLM_MODEL=claude-sonnet-4-5-20250929
DATABASE_URL=postgresql://user:pass@host:5432/dbname
ADMIN_PASSWORD=your_admin_password_here
PORT=3000
```

#### Step 1.3: Create `src/services/db.js` — PostgreSQL Connection + Schema

**File**: `src/services/db.js`
**Action**: CREATE

**Requirements**:
- Use `pg` Pool with `DATABASE_URL` from environment
- Auto-create tables on `initDB()` call (idempotent with `IF NOT EXISTS`)
- Sessions table schema:
  - `id` — UUID primary key
  - `created_at` — TIMESTAMPTZ default NOW()
  - `completed_at` — TIMESTAMPTZ nullable
  - `is_complete` — BOOLEAN default false
  - `messages` — JSONB (array of `{role: 'user'|'assistant', content: string}`)
  - `markdown` — TEXT nullable (generated PRP)
  - `client_name` — TEXT nullable (extracted from conversation)
  - `turn_count` — INTEGER default 0

**Exported functions**:
- `initDB()` — creates tables, called once at server startup
- `createSession(sessionId)` — INSERT new row, return session object
- `getSession(sessionId)` — SELECT by id, return session or null
- `updateSession(sessionId, updates)` — UPDATE specified fields
- `listCompletedSessions()` — SELECT all where is_complete=true, ordered by completed_at DESC

**Example pattern** (matches existing codebase style):
```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      is_complete BOOLEAN DEFAULT false,
      messages JSONB DEFAULT '[]'::jsonb,
      markdown TEXT,
      client_name TEXT,
      turn_count INTEGER DEFAULT 0
    )
  `);
}
```

**Validation**: After creating, run `node -e "require('./src/services/db').initDB().then(() => console.log('DB OK'))"` (requires DATABASE_URL set)

#### Step 1.4: Update `src/services/session-manager.js` — PostgreSQL-Backed

**File**: `src/services/session-manager.js`
**Action**: MODIFY — replace in-memory Map with PostgreSQL calls

**Current code to replace** (the entire file):
- Remove `const sessions = new Map()` and the cleanup interval
- Remove `addAnswer()` (no longer needed — conversation engine handles messages)
- All functions become `async`

**New interface**:
```javascript
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

async function createSession() {
  const sessionId = uuidv4();
  return db.createSession(sessionId);
}

async function getSession(sessionId) {
  return db.getSession(sessionId);
}

async function updateSession(sessionId, updates) {
  return db.updateSession(sessionId, updates);
}

async function listCompletedSessions() {
  return db.listCompletedSessions();
}

module.exports = { createSession, getSession, updateSession, listCompletedSessions };
```

**Key change**: `deleteSession()` is removed. Sessions persist in DB. The old auto-cleanup interval is removed.

**Validation**: Existing routes that call session-manager will need to be updated to use `await` (handled in Phase 2).

---

### Phase 2: LLM Integration

#### Step 2.1: Create `src/services/llm.js` — Anthropic API Wrapper

**File**: `src/services/llm.js`
**Action**: CREATE

**Requirements**:
- Initialize `@anthropic-ai/sdk` Anthropic client using `ANTHROPIC_API_KEY` env var
- Model configurable via `LLM_MODEL` env var, default `claude-sonnet-4-5-20250929`
- Two exported functions:

**`chatCompletion(systemPrompt, messages)`**:
- Calls `client.messages.create()` with system prompt and message history
- `max_tokens`: 1024
- Parses response: extract JSON from response text (strip markdown code fences if present)
- Returns parsed object: `{ message, isComplete, coveredCategories, confidence }`
- Fallback: if JSON parse fails, return `{ message: rawText, isComplete: false, coveredCategories: [], confidence: 0 }`

**`generatePRP(systemPrompt, messages)`**:
- Calls `client.messages.create()` with PRP synthesis prompt and full conversation
- `max_tokens`: 4096
- Returns raw text string (markdown)

**JSON extraction logic**:
```javascript
function extractJSON(text) {
  // Strip code fences
  let cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
  // Try to find JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return null;
}
```

**Error handling**: Wrap API calls in try/catch. On error, log and re-throw with descriptive message.

**Validation**: `node -e "require('./src/services/llm').chatCompletion('You are a test.', [{role:'user',content:'Hello'}]).then(r => console.log(r))"` (requires ANTHROPIC_API_KEY)

#### Step 2.2: Create `src/prompts/system-prompt.js` — System Prompts

**File**: `src/prompts/system-prompt.js`
**Action**: CREATE (also create `src/prompts/` directory)

**Two exported constants**:

**`INTERVIEWER_PROMPT`** — System prompt for the conversational interviewer:
```
You are a friendly, warm product intake interviewer. Your job is to understand what a client wants to build through natural conversation. You are NOT technical — you speak in plain language.

## Your Information Targets
You need to gather information across these 8 categories:
1. **Vision** — What they want to build, the big idea, the name
2. **Users** — Who will use it, what problem it solves
3. **Features** — Core capabilities, must-haves
4. **Journey** — Step-by-step user experience
5. **Design** — Look, feel, vibe, colors, mood
6. **Integrations** — External tools, apps, services needed
7. **Scale** — Expected user count, growth expectations
8. **Constraints** — Timeline, budget, limitations

## Conversation Rules
- Ask ONE question at a time
- Start with a warm greeting and ask about their vision
- When an answer is vague, dig deeper with a follow-up before moving on
- Follow interesting threads — if they mention something exciting, explore it
- You CAN suggest best practices ("Many apps like this use..." or "A phased approach might be...")
- You CAN answer questions about what's possible or common approaches
- Keep questions conversational and non-technical
- Never use jargon — translate technical concepts into plain language
- Acknowledge their answers warmly before asking the next question

## Completion Rules
- You need reasonable coverage of at least 6 of the 8 categories
- Confidence threshold: you should feel you have enough detail to write a solid requirements document
- Maximum 20 turns — if you hit 20, wrap up gracefully
- When complete, thank them warmly and tell them their project brief is being generated

## Response Format
You MUST respond with valid JSON in this exact format:
{
  "message": "Your conversational message to the client",
  "isComplete": false,
  "coveredCategories": ["vision", "users"],
  "confidence": 0.4
}

- `message`: Your spoken response (will be read aloud via TTS — keep it natural and conversational)
- `isComplete`: true only when you have sufficient coverage and confidence >= 0.8
- `coveredCategories`: array of category names you've gathered meaningful info on
- `confidence`: 0.0 to 1.0 — how confident you are that you have enough to write a good brief
```

**`PRP_SYNTHESIS_PROMPT`** — System prompt for generating the final PRP document:
```
You are a senior product analyst. You will receive a conversation transcript between an interviewer and a client about a product they want to build.

Your job is to synthesize this conversation into a clean, structured Product Requirements Prompt (PRP) document in markdown format.

## Output Format

Generate a markdown document with these exact sections:

# Project Intake: [Client Name or Project Name] — [Date]

> Voice intake summary

---

## Goal
A clear, concise statement of what the client wants to build and why.

## Why It Matters
The problem being solved, the opportunity, why this project exists.

## Target Users
Who will use this product, their characteristics, and their pain points.

## Core Features
Bulleted list of must-have features, described in plain language.

## User Journey
Step-by-step walkthrough of the primary user experience.

## Design & Feel
Visual direction, mood, style preferences, and any specific design requests.

## Integrations & Dependencies
External systems, APIs, tools, or services that need to connect.

## Scale & Performance
Expected user count, growth trajectory, and performance needs.

## Constraints
Timeline, budget, technical limitations, and other boundaries.

## Success Criteria
How the client will know if the project is successful (inferred from conversation).

---

## Raw Transcript

[Include the full conversation as Q&A pairs]

---

*Generated by Voice Intake — [Date]*

## Rules
- Synthesize spoken language into clean, professional written prose
- Fill in reasonable inferences where the client was vague (mark with "[inferred]")
- Keep the client's voice and intent — don't over-formalize
- If a section has no coverage, write "Not discussed" instead of omitting it
- The raw transcript should include every exchange
```

**Validation**: `node -e "const p = require('./src/prompts/system-prompt'); console.log(p.INTERVIEWER_PROMPT.length, p.PRP_SYNTHESIS_PROMPT.length)"`

#### Step 2.3: Create `src/services/conversation-engine.js` — Orchestration

**File**: `src/services/conversation-engine.js`
**Action**: CREATE

**Requirements**:
- Imports `llm.js` and `session-manager.js`
- Imports prompts from `system-prompt.js`

**Exported functions**:

**`startConversation(session)`**:
1. Create initial messages array: `[{ role: 'user', content: 'Hi, I want to tell you about my project idea.' }]`
2. Call `llm.chatCompletion(INTERVIEWER_PROMPT, messages)`
3. Parse response → extract `message`
4. Update session in DB: set messages to `[{ role: 'assistant', content: response.message }]`
5. Return `{ message: response.message, isComplete: false }`

**`processMessage(session, userMessage)`**:
1. Append `{ role: 'user', content: userMessage }` to session.messages
2. Call `llm.chatCompletion(INTERVIEWER_PROMPT, session.messages)`
3. Parse response
4. Append `{ role: 'assistant', content: response.message }` to session.messages
5. Increment turn_count
6. Update session in DB with new messages and turn_count
7. If `response.isComplete`:
   a. Call `generatePRP(session)` (below)
   b. Extract client name from conversation (scan messages for name patterns)
   c. Update session: `is_complete: true, completed_at: new Date(), markdown: prpMarkdown, client_name: extractedName`
8. Return `{ message: response.message, isComplete: response.isComplete }`

**`generatePRP(session)`** (internal helper):
1. Build messages from session transcript
2. Call `llm.generatePRP(PRP_SYNTHESIS_PROMPT, session.messages)`
3. Return the markdown string

**`extractClientName(messages)`** (internal helper):
```javascript
function extractClientName(messages) {
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const match = userMessages.match(/(?:my name is|I'm|I am|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
  return match ? match[1] : 'Client';
}
```

**Validation**: Full conversation test via curl (see Verification section).

#### Step 2.4: Update `src/routes/session.js` — New API Endpoints

**File**: `src/routes/session.js`
**Action**: MODIFY — replace question-based flow with conversation-based flow

**Remove**:
- Import of `questions` from `../questions`
- Import of `addAnswer` from session-manager
- The `POST /:id/answer` endpoint entirely

**New imports**:
```javascript
const { createSession, getSession } = require('../services/session-manager');
const { startConversation, processMessage } = require('../services/conversation-engine');
```

**Updated endpoints**:

**`POST /` (Create session)**:
```javascript
router.post('/', async (req, res) => {
  try {
    const session = await createSession();
    const result = await startConversation(session);
    res.json({
      sessionId: session.id,
      message: result.message
    });
  } catch (err) {
    console.error('Session creation error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});
```

**`GET /:id` (Session status)**:
```javascript
router.get('/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({
    sessionId: session.id,
    isComplete: session.is_complete,
    turnCount: session.turn_count,
    clientName: session.client_name
  });
});
```

**`POST /:id/message` (Send message — NEW)**:
```javascript
router.post('/:id/message', async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) required' });
  }

  const session = await getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.is_complete) {
    return res.status(400).json({ error: 'Session already complete' });
  }

  try {
    const result = await processMessage(session, message.trim());
    res.json({
      message: result.message,
      isComplete: result.isComplete
    });
  } catch (err) {
    console.error('Message processing error:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});
```

**Validation**: `curl -X POST http://localhost:3000/api/session` should return `{ sessionId, message }` with Claude's greeting.

#### Step 2.5: Update `src/routes/download.js` — Use LLM-Generated Markdown

**File**: `src/routes/download.js`
**Action**: MODIFY

**Changes**:
- Make handler `async`
- Use `await getSession()` instead of sync call
- Use `session.markdown` (LLM-generated) instead of calling `buildMarkdown()`
- Keep `buildMarkdown()` as fallback if `session.markdown` is null

```javascript
const express = require('express');
const router = express.Router();
const { getSession } = require('../services/session-manager');
const { buildMarkdown } = require('../services/markdown-builder');

router.get('/:id', async (req, res) => {
  const session = await getSession(req.params.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!session.is_complete) {
    return res.status(400).json({ error: 'Session not complete' });
  }

  const markdown = session.markdown || buildMarkdown(session);
  const date = new Date().toISOString().split('T')[0];
  const filename = `project-intake-${date}.md`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(markdown);
});

module.exports = router;
```

#### Step 2.6: Update `server.js` — Add DB Init & API Key Check

**File**: `server.js`
**Action**: MODIFY

**Changes to add**:
1. Import and call `initDB()` from `db.js` at startup
2. Add `ANTHROPIC_API_KEY` startup warning
3. Mount admin routes (Phase 3)

```javascript
require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDB } = require('./src/services/db');

const sessionRoutes = require('./src/routes/session');
const ttsRoutes = require('./src/routes/tts');
const downloadRoutes = require('./src/routes/download');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/session', sessionRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/admin', adminRoutes);

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Start with DB initialization
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Voice Intake running on http://localhost:${PORT}`);
      if (!process.env.ELEVENLABS_API_KEY) {
        console.warn('⚠  ELEVENLABS_API_KEY not set — TTS will use browser fallback');
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn('⚠  ANTHROPIC_API_KEY not set — LLM features disabled');
      }
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
```

**Validation**: `npm run dev` should start the server and log "Voice Intake running" with DB initialized.

---

### Phase 3: Admin Dashboard

#### Step 3.1: Create `src/routes/admin.js` — Admin API Routes

**File**: `src/routes/admin.js`
**Action**: CREATE

**Requirements**:
- Simple cookie-based auth using `ADMIN_PASSWORD` env var
- No external auth library — use a plain cookie and comparison

**Endpoints**:

**`POST /api/admin/login`**:
- Body: `{ password }`
- Compare against `process.env.ADMIN_PASSWORD`
- On match: set cookie `admin_token` (value = simple hash or the password itself hashed), return `{ ok: true }`
- On mismatch: return 401 `{ error: 'Invalid password' }`

**Auth middleware** (applied to all other admin routes):
```javascript
function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

Note: This requires adding `cookie-parser` middleware. Install: `npm install cookie-parser`. Add to `server.js`: `app.use(require('cookie-parser')())`.

**`GET /api/admin/sessions`** (protected):
- Call `listCompletedSessions()`
- Return `{ sessions: [{ id, clientName, createdAt, completedAt, turnCount }] }`

**`GET /api/admin/sessions/:id`** (protected):
- Return full session detail: messages, markdown, metadata

**`GET /api/admin/sessions/:id/download`** (protected):
- Same as the public download route but behind admin auth

**Validation**: `curl -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"test123"}'`

#### Step 3.2: Create `public/admin.html` — Admin Dashboard UI

**File**: `public/admin.html`
**Action**: CREATE

**Requirements**:
- Self-contained HTML page with inline CSS and JS (no build step)
- Reuse CSS variables from the existing dark theme (copy `:root` vars)
- Login form: single password field + submit button
- After login: table of completed sessions
  - Columns: Client Name, Date, Turns, Actions (View, Download)
  - Click "View" → expandable panel showing full conversation + generated PRP
  - Click "Download" → triggers markdown file download
- Responsive, works on mobile
- Simple fetch-based API calls, store admin cookie automatically

**Layout**:
```
┌─────────────────────────────────┐
│ Voice Intake — Admin Dashboard  │
├─────────────────────────────────┤
│ [Password: ________] [Login]    │  ← login state
├─────────────────────────────────┤
│ Client Name │ Date │ # │ Actions│  ← after login
│ John Doe    │ 3/1  │ 12│ 📥 👁  │
│ Jane Smith  │ 2/28 │ 8 │ 📥 👁  │
├─────────────────────────────────┤
│ ▼ Expanded Session View         │
│ [Conversation transcript]       │
│ [Generated PRP markdown]        │
└─────────────────────────────────┘
```

**Validation**: Navigate to `http://localhost:3000/admin.html`, log in, see completed sessions.

---

### Phase 4: Frontend — Chat UI

#### Step 4.1: Update `public/index.html` — Chat Interface

**File**: `public/index.html`
**Action**: MODIFY

**Remove**:
- Progress section (`#progress-section` and its children)
- Question number (`#question-number`)
- Question hint (`#question-hint`)
- Summary container items display (keep the screen, modify content)

**Keep unchanged**:
- Welcome screen (same structure)
- Voice orb and indicator
- Transcript area
- Text fallback
- Listening controls (rename "Done Speaking" → "Send")
- Mode toggle
- Toast
- Script tags

**Add to the question screen** (rename conceptually to "conversation screen"):
```html
<!-- Chat history (scrollable) -->
<div class="chat-container" id="chat-container"></div>
```

Place the `chat-container` ABOVE the voice indicator section. The conversation screen layout becomes:
```
[Chat messages - scrollable]
[Voice orb + label]
[Transcript area OR text input]
[Action buttons]
[Mode toggle]
```

**Rename** the confirm buttons:
- "Accept" → "Send" (id stays `btn-accept`)

**Update** the summary screen:
- Change title to "Your PRP is Ready"
- Remove summary-container items (PRP is downloaded, not displayed inline)
- Keep download button

#### Step 4.2: Update `public/css/styles.css` — Chat Styles

**File**: `public/css/styles.css`
**Action**: MODIFY — add new styles, keep all existing styles

**Add these new styles** (do not remove any existing styles):

```css
/* ===== Chat Container ===== */
.chat-container {
  width: 100%;
  max-height: 40vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
  padding: 8px 0;
  scroll-behavior: smooth;
}

.chat-message {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 0.95rem;
  line-height: 1.5;
  animation: fadeIn 0.3s ease;
}

.chat-message--assistant {
  align-self: flex-start;
  background: var(--bg-card);
  border: 1px solid rgba(255,255,255,0.06);
  border-bottom-left-radius: 4px;
  color: var(--text);
}

.chat-message--user {
  align-self: flex-end;
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}

/* ===== Thinking State ===== */
.voice-orb--thinking {
  background: var(--bg-elevated);
  border: 2px solid var(--accent);
  box-shadow: 0 0 20px var(--accent-glow);
  animation: pulse 2s ease-in-out infinite;
}
```

**Modify** the question screen `.screen#screen-question` to use:
```css
#screen-question {
  justify-content: flex-end; /* Push content to bottom, chat fills top */
}
```

#### Step 4.3: Update `public/js/ui.js` — Chat Display Methods

**File**: `public/js/ui.js`
**Action**: MODIFY

**Add to constructor**:
```javascript
this.chatContainer = document.getElementById('chat-container');
```

**Add new methods**:

```javascript
/** Add a message bubble to the chat */
addChatMessage(role, content) {
  const bubble = document.createElement('div');
  bubble.className = `chat-message chat-message--${role}`;
  bubble.textContent = content;
  this.chatContainer.appendChild(bubble);
  this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
}

/** Set orb to "thinking" state (waiting for LLM) */
setOrbThinking() {
  this.voiceOrb.style.display = 'flex';
  this.voiceOrb.className = 'voice-orb voice-orb--thinking';
  this.iconSpeaker.style.display = 'none';
  this.iconMic.style.display = 'none';
  this.voiceLabel.textContent = 'Thinking...';
  this._hideAllActions();
  this.transcriptArea.style.display = 'none';
  this.textFallback.style.display = 'none';
}

/** Clear all chat messages */
clearChat() {
  this.chatContainer.innerHTML = '';
}
```

**Remove** (no longer needed):
- `setProgress(current, total)` method
- `setQuestion(index, text, hint)` method

**Modify** `buildSummary()`:
```javascript
buildSummary() {
  this.summaryContainer.innerHTML = '<p style="color: var(--text-dim); margin-bottom: 16px;">Your project brief has been generated and is ready to download.</p>';
}
```

**Modify** `showScreen()`: Remove the progress section reference (it no longer exists).

#### Step 4.4: Update `public/js/app.js` — Conversation Loop

**File**: `public/js/app.js`
**Action**: MODIFY — complete rewrite of the flow logic

**Remove**:
- `questions[]` array
- `answers[]` array
- `currentIndex` counter
- `presentQuestion()` function
- `stopListening()` → keep but simplify
- `retryAnswer()` → keep but simplify
- `acceptAnswer()` → rename/repurpose to `sendVoiceMessage()`
- `submitText()` → repurpose
- `submitAnswer()` → replace with `sendMessage()`

**New state**:
```javascript
let sessionId = null;
let isVoiceMode = true;
let lastTranscript = '';
```

**New flow**:

```javascript
async function startSession() {
  try {
    ui.showScreen('question');
    ui.setOrbThinking();

    const res = await fetch('/api/session', { method: 'POST' });
    const data = await res.json();
    sessionId = data.sessionId;

    await handleAIResponse(data.message);
  } catch (err) {
    ui.toast('Failed to start session. Please refresh.');
    console.error(err);
  }
}

async function handleAIResponse(message) {
  // Display in chat
  ui.addChatMessage('assistant', message);

  // Speak via TTS
  ui.setOrbSpeaking();
  try {
    await voice.speak(message);
  } catch (err) {
    console.warn('TTS failed:', err);
  }

  // Small pause, then start listening
  await sleep(400);

  if (isVoiceMode && voice.sttSupported) {
    startListening();
  } else {
    isVoiceMode = false;
    ui.showTextMode();
  }
}

async function sendMessage(text) {
  // Display user message in chat
  ui.addChatMessage('user', text);

  // Show thinking state
  ui.setOrbThinking();

  try {
    const res = await fetch(`/api/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();

    if (data.isComplete) {
      ui.addChatMessage('assistant', data.message);
      ui.setOrbSpeaking();
      try { await voice.speak(data.message); } catch(e) {}
      await sleep(600);
      showSummary();
    } else {
      await handleAIResponse(data.message);
    }
  } catch (err) {
    ui.toast('Network error. Please try again.');
    console.error(err);
    // Restore listening state
    if (isVoiceMode) startListening();
    else ui.showTextMode();
  }
}
```

**`acceptAnswer()`** becomes:
```javascript
async function acceptAnswer() {
  const text = lastTranscript.trim();
  if (!text) { ui.toast('No answer to submit.'); return; }
  await sendMessage(text);
}
```

**`submitText()`** becomes:
```javascript
async function submitText() {
  const text = ui.textInput.value.trim();
  if (!text) { ui.toast('Please type a message first.'); return; }
  ui.textInput.value = '';
  await sendMessage(text);
}
```

**`showSummary()`** becomes:
```javascript
function showSummary() {
  ui.buildSummary();
  ui.showScreen('summary');
}
```

**Keep unchanged**: `startListening()`, `stopListening()`, `retryAnswer()`, `toggleMode()`, `downloadBrief()`, `sleep()`.

**Validation**: Full browser test — tap "Begin", hear Claude's greeting, speak/type responses, conversation flows naturally.

---

### Phase 5: Railway Deployment

#### Step 5.1: Prepare for Deployment

Ensure all environment variables are documented in `.env.example`.

#### Step 5.2: Provision PostgreSQL on Railway

```bash
# Install Railway CLI (if not installed)
brew install railway

# Link to Railway project
railway link

# Add PostgreSQL plugin
railway add --plugin postgresql

# DATABASE_URL is auto-injected
```

#### Step 5.3: Set Environment Variables

Via Railway dashboard or CLI:
```bash
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set ELEVENLABS_API_KEY=...
railway variables set ELEVENLABS_VOICE_ID=...
railway variables set ADMIN_PASSWORD=...
railway variables set LLM_MODEL=claude-sonnet-4-5-20250929
```

#### Step 5.4: Deploy

```bash
railway up
```

**Validation**: Hit the deployed URL, run full voice intake flow.

---

## Files Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `package.json` | MODIFY | 1 | Add `@anthropic-ai/sdk`, `pg`, `cookie-parser` |
| `.env.example` | MODIFY | 1 | Add ANTHROPIC_API_KEY, DATABASE_URL, ADMIN_PASSWORD, LLM_MODEL |
| `src/services/db.js` | CREATE | 1 | PostgreSQL connection pool + schema + CRUD |
| `src/services/session-manager.js` | MODIFY | 1 | Replace in-memory Map with async PostgreSQL calls |
| `src/services/llm.js` | CREATE | 2 | Anthropic SDK wrapper (chatCompletion, generatePRP) |
| `src/prompts/system-prompt.js` | CREATE | 2 | Interviewer + PRP synthesis system prompts |
| `src/services/conversation-engine.js` | CREATE | 2 | Conversation orchestration (start, process, generate) |
| `src/routes/session.js` | MODIFY | 2 | Message-based API replacing question-based flow |
| `src/routes/download.js` | MODIFY | 2 | Use LLM-generated markdown with template fallback |
| `server.js` | MODIFY | 2 | DB init, API key check, admin route mount |
| `src/routes/admin.js` | CREATE | 3 | Admin login, session list, session detail, download |
| `public/admin.html` | CREATE | 3 | Admin dashboard UI (login, table, expand, download) |
| `public/index.html` | MODIFY | 4 | Chat container, remove progress bar, update buttons |
| `public/css/styles.css` | MODIFY | 4 | Chat bubbles, thinking state, layout adjustments |
| `public/js/ui.js` | MODIFY | 4 | addChatMessage, setOrbThinking, clearChat, remove setProgress/setQuestion |
| `public/js/app.js` | MODIFY | 4 | Conversation loop replacing question flow |
| `public/js/voice-engine.js` | NO CHANGE | — | Works as-is |
| `src/services/eleven-labs.js` | NO CHANGE | — | Works as-is |
| `src/routes/tts.js` | NO CHANGE | — | Works as-is |
| `src/questions.js` | DEPRECATED | — | No longer imported (keep file for reference) |
| `src/services/markdown-builder.js` | KEEP | — | Fallback if LLM markdown generation fails |

---

## Verification Plan

### Phase 1 Verification
```bash
# 1. Dependencies installed
node -e "require('@anthropic-ai/sdk'); require('pg'); console.log('deps OK')"

# 2. DB connection works
node -e "require('dotenv').config(); require('./src/services/db').initDB().then(() => console.log('DB OK')).catch(e => console.error(e))"
```

### Phase 2 Verification
```bash
# 3. Session creation returns Claude greeting
curl -s -X POST http://localhost:3000/api/session | jq .

# Expected: { "sessionId": "uuid", "message": "Hi there! ..." }

# 4. Conversation works
SESSION_ID=$(curl -s -X POST http://localhost:3000/api/session | jq -r .sessionId)
curl -s -X POST "http://localhost:3000/api/session/$SESSION_ID/message" \
  -H 'Content-Type: application/json' \
  -d '{"message": "I want to build a dog walking app called PawWalk"}' | jq .

# Expected: { "message": "That sounds great! ...", "isComplete": false }

# 5. Multiple turns until completion
curl -s -X POST "http://localhost:3000/api/session/$SESSION_ID/message" \
  -H 'Content-Type: application/json' \
  -d '{"message": "Dog owners who are busy professionals. They need someone to walk their dogs while they work."}' | jq .

# 6. Download after completion
curl -s "http://localhost:3000/api/download/$SESSION_ID" -o intake.md && cat intake.md
```

### Phase 3 Verification
```bash
# 7. Admin login
curl -s -X POST http://localhost:3000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"password": "your_admin_password"}' -c cookies.txt | jq .

# 8. List sessions
curl -s http://localhost:3000/api/admin/sessions -b cookies.txt | jq .
```

### Phase 4 Verification
- Open browser to `http://localhost:3000`
- Click "Tap to Begin"
- Verify Claude greeting appears as chat bubble and is spoken
- Speak or type a response
- Verify Claude's follow-up appears as chat bubble
- Continue conversation until completion
- Verify "Your PRP is Ready" screen with download button
- Download and verify PRP quality

### Phase 5 Verification
```bash
railway up
# Open deployed URL, run full flow
```

---

## Error Handling & Edge Cases

1. **LLM API timeout**: If Claude doesn't respond within 30 seconds, return a generic "I'm having trouble thinking right now. Could you repeat that?" message
2. **JSON parse failure**: If Claude returns non-JSON, wrap the raw text in the expected format with `isComplete: false`
3. **Database connection lost**: Retry connection 3 times with exponential backoff before failing
4. **20-turn safety rail**: If conversation hits 20 turns without completion, force `isComplete: true` and generate PRP from whatever was gathered
5. **Empty user message**: Reject with 400 error before sending to Claude
6. **Session not found**: Return 404 consistently across all endpoints
7. **Admin auth**: Simple cookie comparison — no JWT overhead needed for single-password auth

---

## Dependencies to Install

```bash
npm install @anthropic-ai/sdk pg cookie-parser
```

Total new dependencies: 3

---

*Generated by Claude — 2026-03-03*
