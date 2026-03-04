/**
 * VoiceEngine — handles 11Labs TTS playback and Web Speech API STT.
 * Falls back to browser TTS and text input when APIs unavailable.
 */
class VoiceEngine {
  constructor() {
    this.audioContext = null;
    this.recognition = null;
    this.isListening = false;
    this.currentAudio = null;
    this._silenceTimer = null;

    // Callbacks for orb visualizer
    this.onAudioCreated = null;      // (audioElement) => void — for connecting AudioContext
    this.onBrowserTTSStart = null;   // () => void
    this.onBrowserTTSEnd = null;     // () => void

    // Check browser STT support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.sttSupported = !!SpeechRecognition;

    if (this.sttSupported) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      this.recognition.maxAlternatives = 1;
    }

    // Check browser TTS support (fallback)
    this.browserTtsSupported = 'speechSynthesis' in window;
  }

  /**
   * Speak text using 11Labs API (via server proxy), falling back to browser TTS.
   * Returns a Promise that resolves when speech finishes.
   */
  async speak(text) {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const data = await response.json();

      if (data.fallback || !data.audio) {
        return this._browserSpeak(text);
      }

      return this._playBase64Audio(data.audio);
    } catch (err) {
      console.warn('11Labs TTS failed, using browser fallback:', err);
      return this._browserSpeak(text);
    }
  }

  /**
   * Play base64-encoded audio and return a Promise that resolves when done.
   */
  _playBase64Audio(base64) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
      this.currentAudio = audio;

      if (this.onAudioCreated) {
        this.onAudioCreated(audio);
      }

      audio.onended = () => {
        this.currentAudio = null;
        resolve();
      };

      audio.onerror = (err) => {
        this.currentAudio = null;
        reject(err);
      };

      audio.play().catch(reject);
    });
  }

  /**
   * Browser TTS fallback.
   */
  _browserSpeak(text) {
    return new Promise((resolve) => {
      if (!this.browserTtsSupported) {
        // No TTS at all — just resolve after a pause
        setTimeout(resolve, 1000);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      if (this.onBrowserTTSStart) this.onBrowserTTSStart();
      utterance.onend = () => {
        if (this.onBrowserTTSEnd) this.onBrowserTTSEnd();
        resolve();
      };
      utterance.onerror = () => {
        if (this.onBrowserTTSEnd) this.onBrowserTTSEnd();
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Stop any currently playing audio.
   */
  stopSpeaking() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.browserTtsSupported) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Start listening via Web Speech API.
   * Calls onInterim(text) for partial results, onFinal(text) when recognition ends.
   * Returns false if STT not supported.
   */
  startListening({ onInterim, onFinal, onError }) {
    if (!this.sttSupported) return false;

    let finalTranscript = '';
    let interimTranscript = '';

    this.recognition.onresult = (event) => {
      interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript = transcript;
        }
      }

      if (onInterim) {
        onInterim(finalTranscript + interimTranscript, !!interimTranscript);
      }

      // Reset silence timer — auto-stop after 2s of silence
      clearTimeout(this._silenceTimer);
      if (finalTranscript.trim()) {
        this._silenceTimer = setTimeout(() => {
          if (this.isListening) {
            this.recognition.stop();
          }
        }, 2000);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('STT error:', event.error);
      if (onError) onError(event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (onFinal) onFinal(finalTranscript.trim());
    };

    try {
      finalTranscript = '';
      interimTranscript = '';
      this.recognition.start();
      this.isListening = true;
      return true;
    } catch (err) {
      console.warn('Failed to start STT:', err);
      if (onError) onError('start-failed');
      return false;
    }
  }

  /**
   * Stop listening and trigger onFinal.
   */
  stopListening() {
    clearTimeout(this._silenceTimer);
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
  }
}

// Export as global
window.VoiceEngine = VoiceEngine;
