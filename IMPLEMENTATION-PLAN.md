# Plan: Transform Voice Intake into LLM-Driven Conversational Platform

## Context

The current voice-intake app uses 8 hardcoded questions in a linear flow. We're transforming it into an LLM-centric conversational experience where Claude (Anthropic API) drives the conversation — asking contextual follow-ups, answering best-practice questions, suggesting phased approaches, and generating a detailed PRP document.

Additionally: PostgreSQL on Railway for persistence, and a password-protected admin dashboard for the product owner to view/download completed intake briefs as markdown files.

## Architecture Changes

**Current:** Fixed questions → answers by index → template markdown
**New:** Claude conversation → adaptive follow-ups → LLM-synthesized PRP

---

## Phase 1: Backend — Install Dependencies & Database Setup

### 1.1 Install dependencies
- `npm install @anthropic-ai/sdk pg` in `/voice-intake`
- Install Railway CLI: `brew install railway`

### 1.2 Update `.env.example`
```
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ANTHROPIC_API_KEY=
LLM_MODEL=claude-sonnet-4-5-20250929
DATABASE_URL=
ADMIN_PASSWORD=
PORT=3000
```

### 1.3 Create `src/services/db.js` — PostgreSQL connection + schema
- Use `pg` Pool with `DATABASE_URL` from env
- Auto-create tables on startup:
  - `sessions` table: id (UUID PK), created_at, completed_at, is_complete, messages (JSONB), markdown (TEXT), client_name (TEXT)
- Expose: `createSession()`, `getSession()`, `updateSession()`, `listCompletedSessions()`

### 1.4 Update `src/services/session-manager.js`
- Replace in-memory Map with PostgreSQL calls
- Keep the same interface but backed by `db.js`
- Session shape becomes:
  ```js
  {
    sessionId, createdAt, messages: [], // {role, content}[]
    turnCount: 0, isComplete: false, completedAt: null,
    markdown: null, clientName: null
  }
  ```

---

## Phase 2: Backend — LLM Integration

### 2.1 Create `src/services/llm.js` — Anthropic API wrapper
- Initialize `@anthropic-ai/sdk` client with env key
- `chatCompletion(systemPrompt, messages)` — returns parsed JSON response
- `generatePRP(systemPrompt, messages)` — returns markdown string
- Handle JSON parsing: strip code fences, extract `{...}`, fallback to raw text

### 2.2 Create `src/prompts/system-prompt.js` — System prompts
**Interviewer prompt:**
- Friendly, non-technical persona
- 8 info targets (vision, users, features, journey, look/feel, integrations, scale, constraints)
- Must respond with JSON: `{ message, isComplete, coveredCategories, confidence }`
- Conversation rules: one question at a time, dig into vague answers, follow interesting threads
- Can suggest best practices, phased approaches, answer client questions about what's possible
- 20-turn safety rail

**PRP synthesis prompt:**
- Takes conversation transcript → generates structured PRP markdown
- Sections: Goal, Why, What, Success Criteria, User Persona, Features, Design, Dependencies, Constraints, Transcript
- Synthesizes spoken language into clean written prose

### 2.3 Create `src/services/conversation-engine.js` — Orchestration
- `startConversation(session)` — initial Claude call, returns greeting
- `processMessage(session, userMessage)` — appends message, calls Claude, checks completion
- On completion: triggers PRP generation via separate Claude call, stores markdown on session
- Extracts client name from conversation for session metadata

### 2.4 Update `src/routes/session.js` — New API endpoints
- `POST /api/session` — create session, call Claude for greeting, return `{ sessionId, message }`
- `POST /api/session/:id/message` — send user message, get Claude response `{ message, isComplete }`
- `GET /api/session/:id` — session status
- Remove the old `POST /api/session/:id/answer` endpoint

### 2.5 Update `src/routes/download.js`
- Use `session.markdown` (LLM-generated) instead of template builder
- Keep markdown-builder.js as fallback if LLM generation somehow fails

### 2.6 Update `server.js`
- Add ANTHROPIC_API_KEY startup check
- Initialize DB on startup (create tables)

---

## Phase 3: Admin Dashboard

### 3.1 Create `src/routes/admin.js` — Admin API routes
- `POST /api/admin/login` — validates password against env `ADMIN_PASSWORD`, returns session cookie
- `GET /api/admin/sessions` — lists completed sessions (id, clientName, date, turn count)
- `GET /api/admin/sessions/:id` — full session detail (messages + markdown)
- `GET /api/admin/sessions/:id/download` — download markdown as file
- Simple middleware: check auth cookie on admin routes

### 3.2 Create `public/admin.html` — Simple dashboard page
- Login form (just password)
- Table of completed intakes: client name, date, turns, download link
- Click row → view full conversation + generated PRP
- Download button per session
- Minimal styling reusing existing dark theme

---

## Phase 4: Frontend — Chat UI

### 4.1 Update `public/index.html`
- Replace "question" screen with "conversation" screen
- Add scrollable `chat-container` for message history
- Keep voice orb, transcript area, text fallback, mode toggle
- Remove progress bar, question number, question hint
- Rename "Accept" → "Send"

### 4.2 Update `public/css/styles.css`
- Add `.chat-container` (scrollable, flex-grow)
- Add `.chat-message`, `.chat-message--assistant`, `.chat-message--user` (bubbles)
- Add `.voice-orb--thinking` state (neutral pulse)
- Keep all existing styles (dark theme, orb, buttons)

### 4.3 Update `public/js/ui.js`
- Add `addChatMessage(role, content)` — append bubble, auto-scroll
- Add `setOrbThinking()` — "Thinking..." state
- Add `clearChat()` — reset chat container
- Remove `setProgress()`, `setQuestion()` — no longer needed
- Update `buildSummary()` to show "Your PRP is ready" with download

### 4.4 Update `public/js/app.js` — Conversation loop
- Remove: `questions[]`, `answers[]`, `currentIndex`, `presentQuestion()`
- New state: `sessionId`, `isVoiceMode`, `lastTranscript`
- New flow:
  1. `startSession()` → POST /api/session → get greeting → `handleAIResponse()`
  2. `handleAIResponse(msg)` → display in chat → speak via TTS → listen for user
  3. User speaks/types → `sendMessage(text)` → POST /api/session/:id/message → get response
  4. If `isComplete` → show summary screen with download
  5. Loop 2-3 until complete

### 4.5 `public/js/voice-engine.js` — NO CHANGES
Voice engine works as-is for the new flow.

---

## Phase 5: Railway Deployment

### 5.1 Install Railway CLI
- `brew install railway`

### 5.2 Provision PostgreSQL
- `railway add --plugin postgresql` (or via Railway dashboard)
- `DATABASE_URL` auto-injected into env

### 5.3 Set environment variables on Railway
- `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ADMIN_PASSWORD`, `LLM_MODEL`

### 5.4 Deploy
- `railway up` from voice-intake directory

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | MODIFY | Add `@anthropic-ai/sdk`, `pg` |
| `.env.example` | MODIFY | Add new env vars |
| `server.js` | MODIFY | Add DB init, API key check |
| `src/services/db.js` | CREATE | PostgreSQL connection + queries |
| `src/services/llm.js` | CREATE | Anthropic API wrapper |
| `src/services/conversation-engine.js` | CREATE | Conversation orchestration |
| `src/prompts/system-prompt.js` | CREATE | Interviewer + PRP synthesis prompts |
| `src/routes/admin.js` | CREATE | Admin dashboard API |
| `public/admin.html` | CREATE | Admin dashboard UI |
| `src/services/session-manager.js` | MODIFY | PostgreSQL-backed sessions |
| `src/routes/session.js` | MODIFY | Message-based conversation API |
| `src/routes/download.js` | MODIFY | Use LLM-generated markdown |
| `public/index.html` | MODIFY | Chat UI instead of question flow |
| `public/css/styles.css` | MODIFY | Chat bubbles, thinking state |
| `public/js/app.js` | MODIFY | Conversation loop |
| `public/js/ui.js` | MODIFY | Chat display methods |
| `public/js/voice-engine.js` | NO CHANGE | Works as-is |
| `src/services/eleven-labs.js` | NO CHANGE | Works as-is |
| `src/routes/tts.js` | NO CHANGE | Works as-is |

## Verification

1. **Backend test:** `curl -X POST localhost:3000/api/session` → should return `{ sessionId, message }` with Claude's greeting
2. **Conversation test:** Send multiple messages via curl, verify Claude asks follow-ups and eventually returns `isComplete: true`
3. **PRP generation test:** After completion, `GET /api/download/:id` returns a well-structured PRP markdown
4. **Admin test:** Login at `/admin.html`, verify completed sessions appear, download works
5. **Voice test:** Full end-to-end in browser with microphone — speak answers, hear Claude's questions
6. **Railway test:** `railway up`, verify PostgreSQL connection, test full flow on deployed URL
