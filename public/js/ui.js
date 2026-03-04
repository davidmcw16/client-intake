/**
 * UI — DOM manipulation, screen transitions, visual state.
 */
class UI {
  constructor() {
    // Screens
    this.screens = {
      welcome: document.getElementById('screen-welcome'),
      question: document.getElementById('screen-question'),
      summary: document.getElementById('screen-summary')
    };

    // Chat container
    this.chatContainer = document.getElementById('chat-container');

    // Voice elements
    this.voiceOrb = document.getElementById('voice-orb');
    this.voiceLabel = document.getElementById('voice-label');
    this.visualizer = new OrbVisualizer(document.getElementById('orb-canvas'));

    // Transcript
    this.transcriptArea = document.getElementById('transcript-area');
    this.transcriptText = document.getElementById('transcript-text');

    // Text fallback
    this.textFallback = document.getElementById('text-fallback');
    this.textInput = document.getElementById('text-input');

    // Action groups
    this.actionsListening = document.getElementById('actions-listening');
    this.actionsConfirm = document.getElementById('actions-confirm');
    this.actionsText = document.getElementById('actions-text');
    this.modeToggle = document.getElementById('btn-mode-toggle');

    // Summary
    this.summaryContainer = document.getElementById('summary-container');

    // Toast
    this.toastEl = document.getElementById('toast');
    this.toastTimeout = null;
  }

  /** Switch to a named screen */
  showScreen(name) {
    Object.values(this.screens).forEach(s => s.classList.remove('active'));
    this.screens[name].classList.add('active');
  }

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
    this.voiceOrb.className = 'voice-orb';
    this.visualizer.setState('thinking');
    this.voiceLabel.textContent = 'Thinking...';
    this._hideAllActions();
    this.transcriptArea.style.display = 'none';
    this.textFallback.style.display = 'none';
  }

  /** Clear all chat messages */
  clearChat() {
    this.chatContainer.innerHTML = '';
  }

  /** Voice orb states */
  setOrbSpeaking() {
    this.voiceOrb.className = 'voice-orb';
    this.visualizer.setState('speaking');
    this.voiceLabel.textContent = 'Speaking...';
    this._hideAllActions();
    this.transcriptArea.style.display = 'none';
    this.textFallback.style.display = 'none';
  }

  setOrbListening() {
    this.voiceOrb.className = 'voice-orb';
    this.visualizer.setState('listening');
    this.voiceLabel.textContent = 'Listening...';
    this.transcriptArea.style.display = 'block';
    this.transcriptText.textContent = '';
    this.transcriptText.className = 'transcript-text';
    this._hideAllActions();
    this.actionsListening.style.display = 'flex';
    this.modeToggle.style.display = 'block';
    this.modeToggle.textContent = 'Switch to typing';
  }

  setOrbIdle() {
    this.voiceOrb.className = 'voice-orb';
    this.visualizer.setState('idle');
    this.voiceLabel.textContent = '';
    this._hideAllActions();
  }

  /** Update live transcript */
  setTranscript(text, isInterim) {
    this.transcriptText.textContent = text || 'Listening...';
    this.transcriptText.className = isInterim ? 'transcript-text interim' : 'transcript-text';
  }

  /** Show confirm buttons after transcription */
  showConfirm(transcript) {
    this.setOrbIdle();
    this.voiceLabel.textContent = 'Review your answer';
    this.transcriptArea.style.display = 'block';
    this.transcriptText.textContent = transcript;
    this.transcriptText.className = 'transcript-text';
    this._hideAllActions();
    this.actionsConfirm.style.display = 'flex';
    this.modeToggle.style.display = 'none';
  }

  /** Switch to text input mode */
  showTextMode() {
    this.setOrbIdle();
    this.voiceOrb.style.display = 'none';
    this.voiceLabel.textContent = '';
    this.transcriptArea.style.display = 'none';
    this._hideAllActions();
    this.textFallback.style.display = 'block';
    this.textInput.value = '';
    this.textInput.focus();
    this.actionsText.style.display = 'flex';
    this.modeToggle.style.display = 'block';
    this.modeToggle.textContent = 'Switch to voice';
  }

  /** Switch back to voice mode */
  showVoiceMode() {
    this.voiceOrb.style.display = 'flex';
    this.textFallback.style.display = 'none';
    this._hideAllActions();
    this.modeToggle.style.display = 'block';
    this.modeToggle.textContent = 'Switch to typing';
  }

  /** Build summary screen — generic fallback */
  buildSummary() {
    this.summaryContainer.innerHTML = '<p style="color: var(--text-dim); margin-bottom: 16px;">Your project brief has been generated and is ready to download.</p>';
  }

  /** Build summary screen — polling state */
  buildSummaryPolling() {
    this.summaryContainer.innerHTML = `
      <div style="text-align: center;">
        <div class="polling-spinner"></div>
        <p style="color: var(--text-dim); margin-top: 16px;">Generating your project brief...</p>
        <p style="color: var(--text-dim); font-size: 0.85rem;">This usually takes 30–60 seconds.</p>
      </div>
    `;
    document.getElementById('btn-download').style.display = 'none';
  }

  /** Build summary screen — ready to download */
  buildSummaryReady(clientName, turnCount) {
    const details = clientName && clientName !== 'Client'
      ? `<p style="color: var(--text-dim); font-size: 0.9rem; margin-bottom: 8px;">Client: ${clientName}${turnCount ? ` &middot; ${turnCount} turns` : ''}</p>`
      : '';
    this.summaryContainer.innerHTML = `
      ${details}
      <p style="color: var(--text-dim); margin-bottom: 16px;">Your project brief is ready to download.</p>
    `;
    document.getElementById('btn-download').style.display = 'inline-flex';
  }

  /** Show a toast notification */
  toast(message, duration = 3000) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, duration);
  }

  _hideAllActions() {
    this.actionsListening.style.display = 'none';
    this.actionsConfirm.style.display = 'none';
    this.actionsText.style.display = 'none';
  }
}

window.UI = UI;
