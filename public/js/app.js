let sessionId = null;
let isVoiceMode = true;
let currentTranscript = '';

document.addEventListener('DOMContentLoaded', async () => {
  var mode = await VoiceEngine.init();
  if (mode === 'text') {
    isVoiceMode = false;
  }

  document.getElementById('btn-begin').addEventListener('click', beginIntake);
  document.getElementById('btn-done-speaking').addEventListener('click', doneSpeaking);
  document.getElementById('btn-try-again').addEventListener('click', tryAgain);
  document.getElementById('btn-send').addEventListener('click', sendVoiceMessage);
  document.getElementById('btn-send-text').addEventListener('click', sendTextMessage);
  document.getElementById('toggle-input-mode').addEventListener('click', toggleInputMode);
  document.getElementById('btn-download').addEventListener('click', downloadBrief);
  document.getElementById('btn-start-over').addEventListener('click', startOver);
});

async function beginIntake() {
  UI.showScreen('screen-conversation');
  UI.setOrbState('thinking');
  UI.showAiMessage('Starting...');

  // Request mic permission on this user gesture (tap) before anything else
  if (isVoiceMode) {
    var micOk = await VoiceEngine.requestMicPermission();
    if (!micOk) {
      // Check if mic API is even available (requires HTTPS or localhost)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        UI.showToast('Voice requires HTTPS or localhost. Using text mode.', { duration: 5000, type: 'warning' });
      } else {
        UI.showToast('Microphone access denied. Using text mode.', { duration: 4000, type: 'warning' });
      }
      isVoiceMode = false;
    }
  }

  try {
    var data = await apiCall('/api/session', { method: 'POST' });
    sessionId = data.sessionId;
    UI.showAiMessage(data.message);
    UI.setOrbState('speaking');
    await VoiceEngine.speak(data.message);
    startListening();
  } catch (e) {
    UI.showToast('Failed to start. Please try again.');
    UI.showScreen('screen-welcome');
  }
}

function startListening() {
  if (!isVoiceMode) {
    UI.showTextInput();
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
    return;
  }
  UI.setOrbState('listening');
  UI.showVoiceControls();
  UI.showToggleLink('Switch to typing');
  currentTranscript = '';
  VoiceEngine.startListening(onInterim, onFinal, onSttError);
}

function onInterim(text) {
  currentTranscript = text;
  UI.showTranscript(text, false);
}

function onFinal(text) {
  currentTranscript = text;
  UI.showTranscript(text, true);
}

function onSttError(err) {
  if (err === 'mic-denied') {
    isVoiceMode = false;
    UI.showToast('Microphone access denied. Switching to typing.', { type: 'warning' });
    UI.showTextInput();
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
  }
}

function doneSpeaking() {
  VoiceEngine.stopListening();
  if (currentTranscript) {
    UI.showTranscript(currentTranscript, true);
    UI.setOrbState('idle');
  } else {
    UI.showToast("I didn't catch that. Try again.");
    startListening();
  }
}

function tryAgain() {
  UI.hideReviewControls();
  UI.hideTranscript();
  currentTranscript = '';
  startListening();
}

async function sendVoiceMessage() {
  UI.hideReviewControls();
  UI.hideTranscript();
  await sendMessage(currentTranscript);
}

async function sendTextMessage() {
  var text = UI.getTextInputValue();
  if (!text) return;
  await sendMessage(text);
}

async function sendMessage(message) {
  UI.setOrbState('thinking');
  UI.hideVoiceControls();
  UI.hideTextInput();
  UI.hideToggleLink();
  try {
    var data = await apiCall('/api/session/' + sessionId + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message })
    });
    await handleResponse(data);
  } catch (e) {
    UI.showToast('Something went wrong. Please try again.');
    startListening();
  }
}

async function handleResponse(data) {
  UI.showAiMessage(data.message);
  UI.setOrbState('speaking');
  await VoiceEngine.speak(data.message);
  if (data.isComplete) {
    UI.showScreen('screen-summary');
  } else {
    startListening();
  }
}

function toggleInputMode(e) {
  e.preventDefault();
  if (isVoiceMode) {
    isVoiceMode = false;
    VoiceEngine.stopListening();
    UI.hideVoiceControls();
    UI.hideReviewControls();
    UI.hideTranscript();
    UI.showTextInput();
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
  } else {
    isVoiceMode = true;
    UI.hideTextInput();
    startListening();
  }
}

function downloadBrief() {
  window.location.href = '/api/download/' + sessionId;
}

function startOver() {
  sessionId = null;
  currentTranscript = '';
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
