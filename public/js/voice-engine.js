window.VoiceEngine = (() => {
  let sttMode = 'text';
  let deepgramKey = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let dgSocket = null;
  let recognition = null;
  let currentAudio = null;
  let isSpeaking = false;

  async function init() {
    // Pre-warm browser TTS voices
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = function () {
        window.speechSynthesis.getVoices();
      };
    }

    try {
      const res = await fetch('/api/deepgram-token');
      const data = await res.json();
      if (data.configured && data.key) {
        deepgramKey = data.key;
        sttMode = 'deepgram';
        return sttMode;
      }
    } catch (e) {}

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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

      const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=true&endpointing=300&token=' + deepgramKey;
      dgSocket = new WebSocket(url);

      dgSocket.onopen = () => {
        let mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';
        }
        mediaRecorder = mimeType
          ? new MediaRecorder(mediaStream, { mimeType })
          : new MediaRecorder(mediaStream);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0 && dgSocket && dgSocket.readyState === 1) {
            dgSocket.send(e.data);
          }
        };
        mediaRecorder.start(250);
      };

      dgSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const transcript = data.channel && data.channel.alternatives && data.channel.alternatives[0] && data.channel.alternatives[0].transcript;
          if (transcript) {
            if (data.is_final) {
              onFinal(transcript);
            } else {
              onInterim(transcript);
            }
          }
        } catch (e) {}
      };

      dgSocket.onerror = () => {
        onError('connection-error');
      };

    } else if (sttMode === 'webspeech') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }
        if (interim) onInterim(interim);
        if (final) onFinal(final);
      };

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') onError('mic-denied');
      };

      recognition.start();
    }
  }

  function stopListening() {
    if (sttMode === 'deepgram') {
      if (dgSocket) {
        dgSocket.close();
        dgSocket = null;
      }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder = null;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
    } else if (sttMode === 'webspeech' && recognition) {
      recognition.stop();
      recognition = null;
    }
  }

  async function speak(text) {
    isSpeaking = true;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();

      if (data.audio) {
        const bytes = atob(data.audio);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: data.contentType || 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        return new Promise((resolve) => {
          currentAudio.onended = () => {
            URL.revokeObjectURL(url);
            currentAudio = null;
            isSpeaking = false;
            resolve();
          };
          currentAudio.onerror = () => {
            URL.revokeObjectURL(url);
            currentAudio = null;
            isSpeaking = false;
            resolve();
          };
          currentAudio.play().catch(() => { isSpeaking = false; resolve(); });
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
      // Pick a good English voice if available
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (e) {
      return false;
    }
  }

  function getMode() {
    return sttMode;
  }

  return {
    init,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    getIsSpeaking,
    requestMicPermission,
    getMode
  };
})();
