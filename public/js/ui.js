window.UI = (() => {
  const screens = document.querySelectorAll('.screen');
  const orb = document.getElementById('voice-orb');
  const orbIcon = document.getElementById('orb-icon');
  const orbLabel = document.getElementById('orb-label');
  const aiMessage = document.getElementById('ai-message');
  const transcriptArea = document.getElementById('transcript-area');
  const transcriptText = document.getElementById('transcript-text');
  const voiceControls = document.getElementById('voice-controls');
  const reviewControls = document.getElementById('review-controls');
  const textInputArea = document.getElementById('text-input-area');
  const textInput = document.getElementById('text-input');
  const toggleLink = document.getElementById('toggle-input-mode');
  const toastContainer = document.getElementById('toast-container');

  const orbStates = {
    speaking: { icon: '\u{1F50A}', label: 'Speaking...' },
    listening: { icon: '\u{1F3A4}', label: 'Your turn...' },
    thinking: { icon: '\u2022\u2022\u2022', label: 'Thinking...' },
    idle: { icon: '', label: '' }
  };

  function showScreen(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
  }

  function setOrbState(state) {
    orb.classList.remove('orb-speaking', 'orb-listening', 'orb-thinking', 'orb-idle');
    orb.classList.add('orb-' + state);
    const config = orbStates[state] || orbStates.idle;
    orbIcon.innerHTML = config.icon;
    orbLabel.textContent = config.label;
  }

  function showAiMessage(text) {
    aiMessage.textContent = text;
    aiMessage.classList.remove('hidden');
  }

  function showTranscript(text, isFinal) {
    transcriptText.textContent = text;
    transcriptArea.classList.remove('hidden');
    if (isFinal) showReviewControls();
  }

  function hideTranscript() {
    transcriptArea.classList.add('hidden');
  }

  function showVoiceControls() {
    voiceControls.classList.remove('hidden');
    reviewControls.classList.add('hidden');
    textInputArea.classList.add('hidden');
  }

  function hideVoiceControls() {
    voiceControls.classList.add('hidden');
  }

  function showReviewControls() {
    reviewControls.classList.remove('hidden');
    voiceControls.classList.add('hidden');
  }

  function hideReviewControls() {
    reviewControls.classList.add('hidden');
  }

  function showTextInput() {
    textInputArea.classList.remove('hidden');
    voiceControls.classList.add('hidden');
    reviewControls.classList.add('hidden');
    transcriptArea.classList.add('hidden');
    textInput.focus();
  }

  function hideTextInput() {
    textInputArea.classList.add('hidden');
  }

  function showToggleLink(text) {
    toggleLink.textContent = text;
    toggleLink.classList.remove('hidden');
  }

  function hideToggleLink() {
    toggleLink.classList.add('hidden');
  }

  function showToast(message, opts) {
    if (typeof opts === 'number') { opts = { duration: opts }; }
    opts = opts || {};
    var duration = opts.duration || 3000;
    var type = opts.type || '';
    var toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' toast-' + type : '');
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(function () { toast.remove(); }, 300);
    }, duration);
  }

  function getTextInputValue() {
    var value = textInput.value.trim();
    textInput.value = '';
    return value;
  }

  return {
    showScreen,
    setOrbState,
    showAiMessage,
    showTranscript,
    hideTranscript,
    showVoiceControls,
    hideVoiceControls,
    showReviewControls,
    hideReviewControls,
    showTextInput,
    hideTextInput,
    showToggleLink,
    hideToggleLink,
    showToast,
    getTextInputValue
  };
})();
