/**
 * OrbVisualizer — canvas-based animated voice orb.
 * Draws reactive visuals per state, optionally driven by real audio data.
 */
class OrbVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle'; // idle | speaking | listening | thinking
    this.animFrame = null;

    // Audio analysis
    this.analyser = null;
    this.audioCtx = null;
    this.freqData = null;

    // ElevenLabs SDK frequency data
    this._sdkFreqData = null;

    // Simulated speaking fallback
    this._simulated = false;
    this._simPhase = 0;

    // Animation timing
    this._t = 0;

    this._resize();
    this._animate();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const size = 200;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.scale(dpr, dpr);
    this.cx = 100;
    this.cy = 100;
  }

  /** Connect to an Audio element for real audio-reactive animation */
  connectAudio(audioElement) {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const source = this.audioCtx.createMediaElementSource(audioElement);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this._simulated = false;
    } catch (e) {
      console.warn('OrbVisualizer: could not connect audio, using simulated', e);
      this._simulated = true;
    }
  }

  /** Disconnect analyser (call when audio ends) */
  disconnectAudio() {
    this.analyser = null;
    this.freqData = null;
  }

  setState(state) {
    this.state = state;
    if (state !== 'speaking') {
      this._simulated = false;
    }
  }

  startSimulatedSpeaking() {
    this._simulated = true;
    this._simPhase = 0;
  }

  stopSimulatedSpeaking() {
    this._simulated = false;
  }

  /** Accept frequency data from ElevenLabs SDK */
  setFrequencyData(data) {
    this._sdkFreqData = data;
  }

  /** Get audio level 0-1 from analyser or simulation */
  _getLevel() {
    // Priority 1: ElevenLabs SDK frequency data
    if (this._sdkFreqData && this._sdkFreqData.length > 0) {
      let sum = 0;
      for (let i = 0; i < this._sdkFreqData.length; i++) {
        sum += this._sdkFreqData[i];
      }
      const level = sum / (this._sdkFreqData.length * 255);
      this._sdkFreqData = null; // Consume once
      return level;
    }

    // Priority 2: AudioContext analyser (existing audio element connection)
    if (this.analyser && this.freqData) {
      this.analyser.getByteFrequencyData(this.freqData);
      let sum = 0;
      for (let i = 0; i < this.freqData.length; i++) {
        sum += this.freqData[i];
      }
      return sum / (this.freqData.length * 255);
    }

    // Priority 3: Simulated speaking (browser TTS fallback)
    if (this._simulated) {
      this._simPhase += 0.08;
      return 0.3 + 0.3 * Math.sin(this._simPhase) + 0.1 * Math.sin(this._simPhase * 2.7);
    }

    return 0;
  }

  _animate() {
    this._t += 0.016;
    const ctx = this.ctx;
    const cx = this.cx;
    const cy = this.cy;

    // Clear
    ctx.clearRect(0, 0, 200, 200);

    switch (this.state) {
      case 'speaking':
        this._drawSpeaking(ctx, cx, cy);
        break;
      case 'listening':
        this._drawListening(ctx, cx, cy);
        break;
      case 'thinking':
        this._drawThinking(ctx, cx, cy);
        break;
      default:
        this._drawIdle(ctx, cx, cy);
    }

    this.animFrame = requestAnimationFrame(() => this._animate());
  }

  _drawSpeaking(ctx, cx, cy) {
    const level = this._getLevel();
    const baseR = 36;
    const r = baseR + level * 14;

    // Outer ripple rings
    for (let i = 3; i >= 1; i--) {
      const rippleR = r + i * 8 + level * i * 4;
      const alpha = 0.12 - i * 0.03;
      ctx.beginPath();
      ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99, 102, 241, ${alpha})`;
      ctx.fill();
    }

    // Main circle
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(129, 130, 255, 1)');
    grad.addColorStop(1, 'rgba(99, 102, 241, 1)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Glow
    ctx.shadowColor = 'rgba(99, 102, 241, 0.5)';
    ctx.shadowBlur = 20 + level * 20;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(99, 102, 241, 0.01)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  _drawListening(ctx, cx, cy) {
    const pulse = 1 + 0.06 * Math.sin(this._t * 4);
    const r = 36 * pulse;

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
    ctx.fill();

    // Main circle
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255, 100, 100, 1)');
    grad.addColorStop(1, 'rgba(239, 68, 68, 1)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Glow
    ctx.shadowColor = 'rgba(239, 68, 68, 0.4)';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.01)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  _drawThinking(ctx, cx, cy) {
    const pulse = 1 + 0.04 * Math.sin(this._t * 2);
    const r = 36 * pulse;

    // Outlined circle with accent border
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner fill
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28, 28, 46, 0.9)';
    ctx.fill();

    // Rotating arc indicator
    const startAngle = this._t * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + Math.PI * 0.6);
    ctx.strokeStyle = 'rgba(99, 102, 241, 1)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Subtle glow
    ctx.shadowColor = 'rgba(99, 102, 241, 0.3)';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.01)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  _drawIdle(ctx, cx, cy) {
    const r = 36;

    // Dark circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28, 28, 46, 1)';
    ctx.fill();

    // Subtle border
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  destroy() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
    }
  }
}

window.OrbVisualizer = OrbVisualizer;
