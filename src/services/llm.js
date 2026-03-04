const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CHAT_MODEL = process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';
const PRP_MODEL = process.env.PRP_MODEL || 'claude-sonnet-4-5-20250929';
const OPUS_MODEL = process.env.OPUS_MODEL || 'claude-opus-4-6';

function extractJSON(text) {
  let cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return null;
}

async function chatCompletion(systemPrompt, messages) {
  try {
    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    });

    const rawText = response.content[0].text;
    const parsed = extractJSON(rawText);

    if (parsed && parsed.message) {
      return {
        message: parsed.message,
        isComplete: parsed.isComplete || false,
        coveredCategories: parsed.coveredCategories || [],
        confidence: parsed.confidence || 0
      };
    }

    return {
      message: rawText,
      isComplete: false,
      coveredCategories: [],
      confidence: 0
    };
  } catch (err) {
    console.error('LLM chatCompletion error:', err.message);
    throw new Error(`LLM chat failed: ${err.message}`);
  }
}

async function generatePRP(systemPrompt, messages) {
  try {
    const response = await client.messages.create({
      model: PRP_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages
    });

    return response.content[0].text;
  } catch (err) {
    console.error('LLM generatePRP error:', err.message);
    throw new Error(`LLM PRP generation failed: ${err.message}`);
  }
}

async function generateDevPRP(systemPrompt, messages) {
  try {
    const response = await client.messages.create({
      model: OPUS_MODEL,
      max_tokens: 16384,
      system: systemPrompt,
      messages: messages
    });
    return response.content[0].text;
  } catch (err) {
    console.error('LLM generateDevPRP error:', err.message);
    throw new Error(`LLM Dev PRP generation failed: ${err.message}`);
  }
}

module.exports = { chatCompletion, generatePRP, generateDevPRP };
