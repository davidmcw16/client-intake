let sessionId = null;
let isVoiceMode = true;
let segments = [];
let currentInterim = '';
let isRecording = false;
let sending = false;
let pendingText = '';

document.addEventListener('DOMContentLoaded', async () => {
  var mode = await VoiceEngine.init();
  if (mode === 'text') isVoiceMode = false;

  document.getElementById('btn-begin').addEventListener('click', beginIntake);
  document.getElementById('btn-ptt').addEventListener('click', toggleRecording);
  document.getElementById('btn-send-text').addEventListener('click', sendTextMessage);
  document.getElementById('toggle-input-mode').addEventListener('click', toggleInputMode);
  document.getElementById('btn-download').addEventListener('click', downloadBrief);
  document.getElementById('btn-start-over').addEventListener('click', startOver);

  document.getElementById('text-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });
});

async function beginIntake() {
  UI.showScreen('screen-conversation');
  UI.setOrbState('thinking');
  UI.showAiMessage('Starting...');

  if (isVoiceMode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      UI.showToast('Voice requires HTTPS or localhost. Using text mode.', { duration: 5000, type: 'warning' });
      isVoiceMode = false;
    } else {
      var micOk = await VoiceEngine.requestMicPermission();
      if (!micOk) {
        UI.showToast('Microphone access denied. Using text mode.', { duration: 4000, type: 'warning' });
        isVoiceMode = false;
      }
    }
  }

  try {
    var data = await apiCall('/api/session', { method: 'POST' });
    sessionId = data.sessionId;
    UI.showAiMessage(data.message);
    UI.setOrbState('speaking');
    await VoiceEngine.speak(data.message);
    showInput();
  } catch (e) {
    UI.showToast('Failed to start. Please try again.');
    UI.showScreen('screen-welcome');
  }
}

function showInput() {
  if (sending) return;

  if (!isVoiceMode) {
    UI.hidePTT();
    UI.hideTranscript();
    UI.showTextInput();
    if (pendingText) {
      document.getElementById('text-input').value = pendingText;
    }
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
    return;
  }

  UI.hideTextInput();
  UI.hideTranscript();
  UI.setOrbState('idle');
  UI.showPTT(false);
  UI.showToggleLink('Switch to typing');
}

function toggleRecording() {
  if (isRecording) {
    stopAndSend();
  } else {
    startRecording();
  }
}

function startRecording() {
  isRecording = true;
  segments = [];
  currentInterim = '';
  UI.hideTranscript();
  UI.setOrbState('listening');
  UI.showPTT(true);

  VoiceEngine.startListening(onInterim, onFinal, onSttError);
}

function stopAndSend() {
  isRecording = false;
  VoiceEngine.stopListening();
  UI.showPTT(false);

  var text = getFullTranscript();
  if (text) {
    sendMessage(text);
  } else {
    UI.showToast("Didn't catch anything. Tap the mic and try again.");
    showInput();
  }
}

function onInterim(text) {
  if (!isRecording) return;
  currentInterim = text;
  UI.showTranscript(getDisplayTranscript());
}

function onFinal(text) {
  if (!isRecording) return;
  segments.push(text);
  currentInterim = '';
  UI.showTranscript(getDisplayTranscript());
}

function getFullTranscript() {
  var parts = segments.slice();
  if (currentInterim) parts.push(currentInterim);
  return parts.join(' ').trim();
}

function getDisplayTranscript() {
  var full = getFullTranscript();
  return full || 'Listening...';
}

function onSttError(err) {
  isRecording = false;
  if (err === 'mic-denied') {
    isVoiceMode = false;
    UI.showToast('Microphone access denied. Switching to typing.', { type: 'warning' });
    UI.hidePTT();
    UI.showTextInput();
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
  } else {
    UI.showToast('Voice connection failed. Try again or switch to typing.', { type: 'warning' });
    showInput();
  }
}

async function sendTextMessage() {
  var textEl = document.getElementById('text-input');
  var text = textEl.value.trim();
  if (!text) return;
  pendingText = text;
  await sendMessage(text);
  if (!sending) {
    pendingText = '';
    textEl.value = '';
  }
}

async function sendMessage(message) {
  if (sending) return;
  sending = true;
  UI.setOrbState('thinking');
  UI.hidePTT();
  UI.hideTextInput();
  UI.hideToggleLink();
  UI.hideTranscript();

  try {
    var data = await apiCall('/api/session/' + sessionId + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message })
    });
    pendingText = '';
    document.getElementById('text-input').value = '';
    sending = false;
    await handleResponse(data);
  } catch (e) {
    sending = false;
    UI.showToast('Something went wrong. Please try again.', { type: 'error' });
    showInput();
  }
}

async function handleResponse(data) {
  UI.showAiMessage(data.message);
  UI.setOrbState('speaking');

  await VoiceEngine.speak(data.message);

  if (data.isComplete) {
    UI.showScreen('screen-summary');
  } else {
    showInput();
  }
}

function toggleInputMode(e) {
  e.preventDefault();
  if (isVoiceMode) {
    isVoiceMode = false;
    if (isRecording) {
      isRecording = false;
      VoiceEngine.stopListening();
    }
    VoiceEngine.stopSpeaking();
    UI.hidePTT();
    UI.hideTranscript();
    UI.showTextInput();
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
  } else {
    isVoiceMode = true;
    pendingText = document.getElementById('text-input').value.trim();
    UI.hideTextInput();
    showInput();
  }
}

function downloadBrief() {
  window.location.href = '/api/download/' + sessionId;
}

function startOver() {
  sessionId = null;
  segments = [];
  currentInterim = '';
  pendingText = '';
  sending = false;
  isRecording = false;
  VoiceEngine.stopListening();
  VoiceEngine.stopSpeaking();
  UI.showScreen('screen-welcome');
}

async function apiCall(url, options, retries) {
  options = options || {};
  retries = retries != null ? retries : 1;
  for (var i = 0; i <= retries; i++) {
    try {
      var res = await fetch(url, options);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
  }
}
