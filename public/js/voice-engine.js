window.VoiceEngine = (() => {
  let sttMode = 'text';
  let deepgramKey = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let dgSocket = null;
  let dgConnTimeout = null;
  let recognition = null;
  let currentAudio = null;
  let isSpeaking = false;

  async function init() {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = function () {
        window.speechSynthesis.getVoices();
      };
    }

    try {
      var res = await fetch('/api/deepgram-token');
      var data = await res.json();
      if (data.configured && data.key) {
        deepgramKey = data.key;
        sttMode = 'deepgram';
        return sttMode;
      }
    } catch (e) {}

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      sttMode = 'webspeech';
      return sttMode;
    }

    sttMode = 'text';
    return sttMode;
  }

  async function startListening(onInterim, onFinal, onError) {
    if (sttMode === 'deepgram') {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        onError('mic-denied');
        return;
      }

      var url = 'wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=true&endpointing=500&token=' + deepgramKey;
      dgSocket = new WebSocket(url);

      // Timeout if WebSocket doesn't connect in 5s
      dgConnTimeout = setTimeout(function () {
        if (dgSocket && dgSocket.readyState !== 1) {
          console.warn('Deepgram connection timeout, falling back to Web Speech');
          cleanupDeepgram();
          // Try Web Speech API as fallback
          var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SpeechRecognition) {
            sttMode = 'webspeech';
            startListening(onInterim, onFinal, onError);
          } else {
            onError('connection-error');
          }
        }
      }, 5000);

      dgSocket.onopen = function () {
        clearTimeout(dgConnTimeout);
        dgConnTimeout = null;

        var mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';
        }
        mediaRecorder = mimeType
          ? new MediaRecorder(mediaStream, { mimeType: mimeType })
          : new MediaRecorder(mediaStream);

        mediaRecorder.ondataavailable = function (e) {
          if (e.data.size > 0 && dgSocket && dgSocket.readyState === 1) {
            dgSocket.send(e.data);
          }
        };
        mediaRecorder.start(250);
      };

      dgSocket.onmessage = function (event) {
        try {
          var data = JSON.parse(event.data);
          var alt = data.channel && data.channel.alternatives && data.channel.alternatives[0];
          var transcript = alt && alt.transcript;
          if (transcript) {
            if (data.is_final) {
              onFinal(transcript);
            } else {
              onInterim(transcript);
            }
          }
        } catch (e) {}
      };

      dgSocket.onerror = function () {
        cleanupDeepgram();
        onError('connection-error');
      };

      dgSocket.onclose = function (event) {
        // Only report error if unexpected close while we think we're recording
        if (!event.wasClean && mediaRecorder) {
          cleanupDeepgram();
          onError('connection-error');
        }
      };

    } else if (sttMode === 'webspeech') {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = function (event) {
        var interim = '';
        var final = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }
        if (interim) onInterim(interim);
        if (final) onFinal(final);
      };

      recognition.onerror = function (event) {
        if (event.error === 'not-allowed') onError('mic-denied');
      };

      recognition.start();
    }
  }

  function cleanupDeepgram() {
    if (dgConnTimeout) {
      clearTimeout(dgConnTimeout);
      dgConnTimeout = null;
    }
    if (dgSocket) {
      dgSocket.onmessage = null;
      dgSocket.onerror = null;
      dgSocket.onclose = null;
      dgSocket.close();
      dgSocket = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    mediaRecorder = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) { t.stop(); });
      mediaStream = null;
    }
  }

  function stopListening() {
    if (sttMode === 'deepgram') {
      cleanupDeepgram();
    } else if (sttMode === 'webspeech' && recognition) {
      recognition.stop();
      recognition = null;
    }
  }

  async function speak(text) {
    isSpeaking = true;
    try {
      var res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      });
      var data = await res.json();

      if (data.audio) {
        var bytes = atob(data.audio);
        var arr = new Uint8Array(bytes.length);
        for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        var blob = new Blob([arr], { type: data.contentType || 'audio/mpeg' });
        var url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        return new Promise(function (resolve) {
          currentAudio.onended = function () {
            URL.revokeObjectURL(url);
            currentAudio = null;
            isSpeaking = false;
            resolve();
          };
          currentAudio.onerror = function () {
            URL.revokeObjectURL(url);
            currentAudio = null;
            isSpeaking = false;
            resolve();
          };
          currentAudio.play().catch(function () { isSpeaking = false; resolve(); });
        });
      }

      return speakBrowser(text);
    } catch (e) {
      return speakBrowser(text);
    }
  }

  function speakBrowser(text) {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      var voices = window.speechSynthesis.getVoices();
      var utterance = new SpeechSynthesisUtterance(text);
      var preferred = voices.filter(function (v) { return v.lang.indexOf('en') === 0; });
      if (preferred.length > 0) utterance.voice = preferred[0];
      utterance.rate = 1.05;
      return new Promise(function (resolve) {
        var timeout = setTimeout(function () { isSpeaking = false; resolve(); }, Math.max(3000, text.length * 80));
        utterance.onend = function () { clearTimeout(timeout); isSpeaking = false; resolve(); };
        utterance.onerror = function () { clearTimeout(timeout); isSpeaking = false; resolve(); };
        window.speechSynthesis.speak(utterance);
      });
    }
    isSpeaking = false;
    return Promise.resolve();
  }

  function stopSpeaking() {
    isSpeaking = false;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
  }

  function getIsSpeaking() {
    return isSpeaking;
  }

  async function requestMicPermission() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(function (t) { t.stop(); });
      return true;
    } catch (e) {
      return false;
    }
  }

  function getMode() {
    return sttMode;
  }

  return {
    init: init,
    startListening: startListening,
    stopListening: stopListening,
    speak: speak,
    stopSpeaking: stopSpeaking,
    getIsSpeaking: getIsSpeaking,
    requestMicPermission: requestMicPermission,
    getMode: getMode
  };
})();
