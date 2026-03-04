import { Conversation } from '@elevenlabs/client';

// Import existing modules so esbuild bundles them (they set window globals)
import './orb-visualizer.js';
import './ui.js';
import './voice-engine.js';
(function () {
  const ui = new UI();

  // State
  let conversation = null;  // ElevenLabs Conversation instance
  let isConvAIMode = true;  // true = ElevenLabs ConvAI, false = text fallback
  let sessionEnded = false;
  let convaiConversationId = null; // ElevenLabs conversation ID for polling
  let resolvedSessionId = null;    // Server session ID once webhook processes

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
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('Mic denied, falling back to text mode');
      isConvAIMode = false;
      await startTextSession();
      return;
    }

    try {
      const res = await fetch('/api/convai/signed-url');
      const { signed_url } = await res.json();

      if (!signed_url) throw new Error('No signed URL returned');

      // Patch: ElevenLabs API rejects the 'convai' WebSocket subprotocol with 403.
      // Temporarily override WebSocket to strip it until the SDK is fixed.
      const _WS = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        if (typeof url === 'string' && url.includes('elevenlabs.io')) {
          const filtered = Array.isArray(protocols)
            ? protocols.filter(p => p !== 'convai')
            : protocols;
          return filtered && filtered.length > 0
            ? new _WS(url, filtered)
            : new _WS(url);
        }
        return protocols ? new _WS(url, protocols) : new _WS(url);
      };
      window.WebSocket.prototype = _WS.prototype;
      window.WebSocket.CONNECTING = _WS.CONNECTING;
      window.WebSocket.OPEN = _WS.OPEN;
      window.WebSocket.CLOSING = _WS.CLOSING;
      window.WebSocket.CLOSED = _WS.CLOSED;

      conversation = await Conversation.startSession({
        signedUrl: signed_url,

        onConnect: () => {
          console.log('ConvAI connected');
          convaiConversationId = conversation.getId();
          console.log('Conversation ID:', convaiConversationId);
          ui.visualizer.setState('listening');
          ui.voiceLabel.textContent = 'Listening...';
          startOrbAnimation();
        },

        onDisconnect: (reason) => {
          console.log('ConvAI disconnected, reason:', reason);
          if (!sessionEnded) {
            sessionEnded = true;
            showSummary();
          }
        },

        onMessage: ({ source, message }) => {
          const role = source === 'user' ? 'user' : 'assistant';
          ui.addChatMessage(role, message);
        },

        onModeChange: ({ mode }) => {
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
      ui.toast(`Voice error: ${err.message || err}`);
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
        if (freqData) ui.visualizer.setFrequencyData(freqData);
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
  let fallbackVoice = null;
  let fallbackSessionId = null;

  async function startTextSession() {
    ui.showScreen('question');
    ui.setOrbThinking();
    try {
      if (!fallbackVoice) fallbackVoice = new VoiceEngine();
      const res = await fetch('/api/session', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.sessionId || !data.message) throw new Error(data.error || 'Invalid session response');
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
    if (isConvAIMode) return;

    ui.addChatMessage('user', text);
    ui.setOrbThinking();

    try {
      const res = await fetch(`/api/session/${fallbackSessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      if (!res.ok || !data.message) throw new Error(data.error || 'Failed to get response');
      ui.addChatMessage('assistant', data.message);
      if (data.isComplete) showSummary();
      else ui.showTextMode();
    } catch (err) {
      ui.toast('Network error. Please try again.');
      console.error(err);
      ui.showTextMode();
    }
  }

  function toggleMode() {
    if (isConvAIMode && conversation) {
      conversation.endSession();
      conversation = null;
      isConvAIMode = false;
      stopOrbAnimation();
      startTextSession();
    } else {
      ui.toast('Voice mode is only available at session start.');
    }
  }

  function showSummary() {
    stopOrbAnimation();
    ui.showScreen('summary');

    if (convaiConversationId && !resolvedSessionId) {
      // ConvAI mode — poll for webhook completion
      ui.buildSummaryPolling();
      pollForBrief();
    } else if (resolvedSessionId || fallbackSessionId) {
      ui.buildSummaryReady();
    } else {
      ui.buildSummary();
    }
  }

  let pollTimer = null;

  function pollForBrief() {
    if (!convaiConversationId) return;

    async function check() {
      try {
        const res = await fetch(`/api/webhook/status/${convaiConversationId}`);
        const data = await res.json();

        if (data.status === 'ready') {
          resolvedSessionId = data.sessionId;
          ui.buildSummaryReady(data.clientName, data.turnCount);
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        }
        // 'processing' or 'generating' — keep polling
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    check(); // immediate first check
    pollTimer = setInterval(check, 5000); // then every 5 seconds
  }

  function downloadBrief() {
    const sid = resolvedSessionId || fallbackSessionId;
    if (sid) {
      window.location.href = `/api/download/${sid}`;
    } else {
      ui.toast('Still generating — please wait a moment.');
    }
  }
})();
