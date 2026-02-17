const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.LLM_API_KEY });
const model = process.env.LLM_MODEL || 'claude-sonnet-4-5-20250929';

async function chat(systemPrompt, messages) {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages
    }, { timeout: 15000 });
    return response.content[0].text;
  } catch (err) {
    if (err.name === 'APIConnectionTimeoutError' || (err.message && err.message.includes('timeout'))) {
      throw new Error('LLM_TIMEOUT');
    }
    throw new Error('LLM chat failed: ' + err.message);
  }
}

async function generateMarkdown(systemPrompt, messages) {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages
    }, { timeout: 30000 });
    return response.content[0].text;
  } catch (err) {
    if (err.name === 'APIConnectionTimeoutError' || (err.message && err.message.includes('timeout'))) {
      throw new Error('LLM_TIMEOUT');
    }
    throw new Error('LLM markdown generation failed: ' + err.message);
  }
}

module.exports = { chat, generateMarkdown };
