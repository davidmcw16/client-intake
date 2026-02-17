let sessionId = null;
let isVoiceMode = true;
let currentTranscript = '';
let pendingText = '';
let autoSendTimer = null;
let sending = false;

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

  // Send text on Enter key
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

  // Request mic on user gesture before anything else
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
    startListening();
  } catch (e) {
    UI.showToast('Failed to start. Please try again.');
    UI.showScreen('screen-welcome');
  }
}

function startListening() {
  if (sending) return;
  clearAutoSend();

  if (!isVoiceMode) {
    UI.showTextInput();
    // Restore any pending text that wasn't sent
    if (pendingText) {
      document.getElementById('text-input').value = pendingText;
    }
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
    return;
  }

  UI.setOrbState('listening');
  UI.showVoiceControls();
  UI.showToggleLink('Switch to typing');
  currentTranscript = '';
  UI.hideTranscript();
  VoiceEngine.startListening(onInterim, onFinal, onSttError);
}

function onInterim(text) {
  // Barge-in: if AI is still speaking, stop it
  if (VoiceEngine.getIsSpeaking()) {
    VoiceEngine.stopSpeaking();
    UI.setOrbState('listening');
  }

  currentTranscript = text;
  UI.showTranscript(text, false);
  clearAutoSend();
}

function onFinal(text) {
  // Barge-in
  if (VoiceEngine.getIsSpeaking()) {
    VoiceEngine.stopSpeaking();
  }

  currentTranscript = text;
  UI.showTranscript(text, false);

  // Auto-send after 1.5s of silence (duplex mode)
  clearAutoSend();
  autoSendTimer = setTimeout(function () {
    if (currentTranscript && !sending) {
      autoSendVoice();
    }
  }, 1500);
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

function clearAutoSend() {
  if (autoSendTimer) {
    clearTimeout(autoSendTimer);
    autoSendTimer = null;
  }
}

function doneSpeaking() {
  clearAutoSend();
  VoiceEngine.stopListening();
  if (currentTranscript) {
    // Send immediately when user taps done
    sendFromVoice(currentTranscript);
  } else {
    UI.showToast("I didn't catch that. Try again.");
    startListening();
  }
}

function autoSendVoice() {
  VoiceEngine.stopListening();
  sendFromVoice(currentTranscript);
}

async function sendFromVoice(text) {
  UI.hideReviewControls();
  UI.showTranscript(text, false);
  await sendMessage(text);
}

function tryAgain() {
  clearAutoSend();
  UI.hideReviewControls();
  UI.hideTranscript();
  currentTranscript = '';
  startListening();
}

async function sendVoiceMessage() {
  clearAutoSend();
  UI.hideReviewControls();
  UI.hideTranscript();
  VoiceEngine.stopListening();
  await sendMessage(currentTranscript);
}

async function sendTextMessage() {
  var textEl = document.getElementById('text-input');
  var text = textEl.value.trim();
  if (!text) return;
  pendingText = text;
  await sendMessage(text);
  // Only clear after successful send
  if (!sending) {
    pendingText = '';
    textEl.value = '';
  }
}

async function sendMessage(message) {
  if (sending) return;
  sending = true;
  UI.setOrbState('thinking');
  UI.hideVoiceControls();
  UI.hideToggleLink();

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
    startListening();
  }
}

async function handleResponse(data) {
  UI.showAiMessage(data.message);
  UI.hideTranscript();
  UI.setOrbState('speaking');

  // In voice mode, start listening while AI speaks (duplex)
  if (isVoiceMode && !data.isComplete) {
    // Start listening in parallel with speaking
    VoiceEngine.speak(data.message).then(function () {
      // If no one interrupted, ensure we're in listening state
      if (!sending && !VoiceEngine.getIsSpeaking()) {
        UI.setOrbState('listening');
      }
    });
    // Small delay then start listening for barge-in
    setTimeout(function () {
      if (!data.isComplete && !sending) {
        currentTranscript = '';
        VoiceEngine.startListening(onInterim, onFinal, onSttError);
        UI.showVoiceControls();
        UI.showToggleLink('Switch to typing');
      }
    }, 500);
  } else {
    await VoiceEngine.speak(data.message);
    if (data.isComplete) {
      UI.showScreen('screen-summary');
    } else {
      startListening();
    }
  }
}

function toggleInputMode(e) {
  e.preventDefault();
  clearAutoSend();
  if (isVoiceMode) {
    isVoiceMode = false;
    VoiceEngine.stopListening();
    VoiceEngine.stopSpeaking();
    UI.hideVoiceControls();
    UI.hideReviewControls();
    UI.hideTranscript();
    UI.showTextInput();
    UI.showToggleLink('Switch to voice');
    UI.setOrbState('idle');
  } else {
    isVoiceMode = true;
    pendingText = document.getElementById('text-input').value.trim();
    UI.hideTextInput();
    startListening();
  }
}

function downloadBrief() {
  window.location.href = '/api/download/' + sessionId;
}

function startOver() {
  clearAutoSend();
  sessionId = null;
  currentTranscript = '';
  pendingText = '';
  sending = false;
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
