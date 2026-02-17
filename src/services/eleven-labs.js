async function textToSpeech(text) {
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
    return { fallback: true };
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' })
      }
    );

    if (!response.ok) throw new Error(`ElevenLabs API ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    return { audio: buffer.toString('base64'), contentType: 'audio/mpeg' };
  } catch (err) {
    console.warn('ElevenLabs TTS error:', err.message);
    return { fallback: true };
  }
}

function isConfigured() {
  return !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

module.exports = { textToSpeech, isConfigured };
