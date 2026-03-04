const llm = require('./llm');
const sessionManager = require('./session-manager');
const { INTERVIEWER_PROMPT, PRP_SYNTHESIS_PROMPT } = require('../prompts/system-prompt');

function extractClientName(messages) {
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  const match = userMessages.match(/(?:my name is|I'm|I am|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
  return match ? match[1] : 'Client';
}

async function generatePRPFromSession(session) {
  const transcript = session.messages
    .map(m => `${m.role === 'user' ? 'Client' : 'Interviewer'}: ${m.content}`)
    .join('\n\n');

  return llm.generatePRP(PRP_SYNTHESIS_PROMPT, [
    { role: 'user', content: transcript }
  ]);
}

async function startConversation(session) {
  const messages = [{ role: 'user', content: 'Hi, I want to tell you about my project idea.' }];
  const response = await llm.chatCompletion(INTERVIEWER_PROMPT, messages);

  await sessionManager.updateSession(session.id, {
    messages: JSON.stringify([{ role: 'assistant', content: response.message }])
  });

  return { message: response.message, isComplete: false };
}

async function processMessage(session, userMessage) {
  const messages = Array.isArray(session.messages) ? [...session.messages] : [];
  messages.push({ role: 'user', content: userMessage });

  let response;
  const turnCount = (session.turn_count || 0) + 1;

  // 20-turn safety rail
  if (turnCount >= 20) {
    response = {
      message: "Thank you so much for sharing all of that! I have a great picture of what you're looking for. Let me put together your project brief now — it'll be ready in just a moment!",
      isComplete: true,
      coveredCategories: [],
      confidence: 1.0
    };
  } else {
    response = await llm.chatCompletion(INTERVIEWER_PROMPT, messages);
  }

  messages.push({ role: 'assistant', content: response.message });

  const updates = {
    messages: JSON.stringify(messages),
    turn_count: turnCount
  };

  // Extract client name on every turn (incremental capture)
  const clientName = extractClientName(messages);
  if (clientName !== 'Client') {
    updates.client_name = clientName;
  }

  if (response.isComplete) {
    const prpMarkdown = await generatePRPFromSession({ ...session, messages });
    updates.is_complete = true;
    updates.completed_at = new Date().toISOString();
    updates.markdown = prpMarkdown;
  }

  await sessionManager.updateSession(session.id, updates);

  return { message: response.message, isComplete: response.isComplete };
}

module.exports = { startConversation, processMessage };
