window.UI = (() => {
  const screens = document.querySelectorAll('.screen');
  const orb = document.getElementById('voice-orb');
  const orbIcon = document.getElementById('orb-icon');
  const orbLabel = document.getElementById('orb-label');
  const aiMessage = document.getElementById('ai-message');
  const transcriptArea = document.getElementById('transcript-area');
  const transcriptText = document.getElementById('transcript-text');
  const textInputArea = document.getElementById('text-input-area');
  const textInput = document.getElementById('text-input');
  const toggleLink = document.getElementById('toggle-input-mode');
  const toastContainer = document.getElementById('toast-container');
  const btnPtt = document.getElementById('btn-ptt');
  const pttIcon = document.getElementById('ptt-icon');
  const pttLabel = document.getElementById('ptt-label');

  const orbStates = {
    speaking: { icon: '\u{1F50A}', label: 'Speaking...' },
    listening: { icon: '\u{1F3A4}', label: 'Listening...' },
    thinking: { icon: '\u2022\u2022\u2022', label: 'Thinking...' },
    idle: { icon: '', label: '' }
  };

  function showScreen(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    var target = document.getElementById(screenId);
    if (target) target.classList.add('active');
  }

  function setOrbState(state) {
    orb.classList.remove('orb-speaking', 'orb-listening', 'orb-thinking', 'orb-idle');
    orb.classList.add('orb-' + state);
    var config = orbStates[state] || orbStates.idle;
    orbIcon.innerHTML = config.icon;
    orbLabel.textContent = config.label;
  }

  function showAiMessage(text) {
    aiMessage.textContent = text;
    aiMessage.classList.remove('hidden');
  }

  function showTranscript(text) {
    transcriptText.textContent = text;
    transcriptArea.classList.remove('hidden');
  }

  function hideTranscript() {
    transcriptArea.classList.add('hidden');
  }

  function showPTT(recording) {
    btnPtt.classList.remove('hidden');
    pttLabel.classList.remove('hidden');
    textInputArea.classList.add('hidden');

    if (recording) {
      btnPtt.classList.add('recording');
      pttIcon.textContent = '\u2B06\uFE0F';
      pttLabel.textContent = 'Tap to send';
    } else {
      btnPtt.classList.remove('recording');
      pttIcon.textContent = '\u{1F3A4}';
      pttLabel.textContent = 'Tap to speak';
    }
  }

  function hidePTT() {
    btnPtt.classList.add('hidden');
    btnPtt.classList.remove('recording');
    pttLabel.classList.add('hidden');
  }

  function showTextInput() {
    textInputArea.classList.remove('hidden');
    btnPtt.classList.add('hidden');
    pttLabel.classList.add('hidden');
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

  return {
    showScreen,
    setOrbState,
    showAiMessage,
    showTranscript,
    hideTranscript,
    showPTT,
    hidePTT,
    showTextInput,
    hideTextInput,
    showToggleLink,
    hideToggleLink,
    showToast
  };
})();
