/**
 * WaveBackground — full-screen canvas with flowing sonic waveform lines.
 * Fewer lines, bigger curves, each with unique character.
 */
class WaveBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mouse = { x: 0, y: 0 };
    this.time = 0;
    this.animFrame = null;
    this.dpr = window.devicePixelRatio || 1;

    // Each line gets its own personality — randomized once
    this.lineCount = 14;
    this.lines = [];
    for (let i = 0; i < this.lineCount; i++) {
      this.lines.push({
        // Vertical position (spread across screen)
        yBase: (i / (this.lineCount - 1)) * 0.8 + 0.1, // 10%-90% of height
        // Unique wave parameters per line
        freq1: 1.5 + Math.random() * 1.5,   // primary wave frequency
        freq2: 2.5 + Math.random() * 2.0,   // secondary
        freq3: 0.8 + Math.random() * 0.8,   // slow undulation
        amp1: 0.06 + Math.random() * 0.06,  // amplitudes as % of height
        amp2: 0.025 + Math.random() * 0.03,
        amp3: 0.04 + Math.random() * 0.04,
        speed1: 0.15 + Math.random() * 0.2, // speeds
        speed2: -(0.1 + Math.random() * 0.15), // counter-direction
        speed3: 0.05 + Math.random() * 0.1,
        phase: Math.random() * Math.PI * 2,  // start phase offset
        // Visual
        hue: 235 + Math.random() * 40,       // blue-purple range
        alpha: 0.08 + Math.random() * 0.14,
        width: 1 + Math.random() * 1,
      });
    }

    this._resize();
    this._bindEvents();
    this._animate();
  }

  _resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.scale(this.dpr, this.dpr);
    this.mouse.x = this.width / 2;
    this.mouse.y = this.height / 2;
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this._resize();
    });

    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });

    window.addEventListener('touchmove', (e) => {
      if (e.touches[0]) {
        this.mouse.x = e.touches[0].clientX;
        this.mouse.y = e.touches[0].clientY;
      }
    }, { passive: true });
  }

  _animate() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Fade trail — creates motion blur / ghosting
    ctx.fillStyle = 'rgba(6, 6, 12, 0.08)';
    ctx.fillRect(0, 0, w, h);

    const segmentCount = 120;
    const mx = this.mouse.x / w;
    const my = this.mouse.y / h;

    for (let i = 0; i < this.lineCount; i++) {
      const line = this.lines[i];
      const baseY = line.yBase * h;

      ctx.beginPath();
      ctx.strokeStyle = `hsla(${line.hue}, 80%, 60%, ${line.alpha})`;
      ctx.lineWidth = line.width;

      for (let j = 0; j <= segmentCount; j++) {
        const x = (j / segmentCount) * w;
        const xNorm = j / segmentCount;

        // Three layered sine waves with unique params per line
        const wave1 = Math.sin(xNorm * Math.PI * line.freq1 + this.time * line.speed1 + line.phase) * h * line.amp1;
        const wave2 = Math.sin(xNorm * Math.PI * line.freq2 + this.time * line.speed2 + line.phase * 1.7) * h * line.amp2;
        const wave3 = Math.sin(xNorm * Math.PI * line.freq3 + this.time * line.speed3 + line.phase * 0.5) * h * line.amp3;

        // Mouse pull — lines curve toward cursor
        const dx = xNorm - mx;
        const dy = line.yBase - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pull = Math.max(0, 1 - dist * 2.5) * h * 0.06;
        const mouseBend = pull * Math.sin((xNorm - mx) * Math.PI * 2);

        const y = baseY + wave1 + wave2 + wave3 + mouseBend;

        if (j === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    }

    // Subtle center glow
    const glowGrad = ctx.createRadialGradient(
      w / 2, h / 2, 0,
      w / 2, h / 2, h * 0.45
    );
    glowGrad.addColorStop(0, 'rgba(99, 102, 241, 0.025)');
    glowGrad.addColorStop(1, 'rgba(99, 102, 241, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    this.time += 0.016;
    this.animFrame = requestAnimationFrame(() => this._animate());
  }

  destroy() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
    }
  }
}

window.WaveBackground = WaveBackground;
