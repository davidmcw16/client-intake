/**
 * WaveBackground — full-screen canvas with flowing sonic waveform lines.
 * Subtle, ambient animation that responds to mouse/touch position.
 */
class WaveBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mouse = { x: 0, y: 0 };
    this.time = 0;
    this.animFrame = null;
    this.dpr = window.devicePixelRatio || 1;

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

    // Fade trail effect
    ctx.fillStyle = 'rgba(6, 6, 12, 0.12)';
    ctx.fillRect(0, 0, w, h);

    const lineCount = 40;
    const segmentCount = 100;
    const centerY = h / 2;

    // Mouse influence (normalized)
    const mx = this.mouse.x / w;
    const my = this.mouse.y / h;

    for (let i = 0; i < lineCount; i++) {
      ctx.beginPath();

      const progress = i / lineCount;
      // Spread lines vertically around center
      const yOffset = (progress - 0.5) * h * 0.6;

      // Color: indigo to purple gradient based on line position
      const hue = 240 + progress * 30; // 240 (blue) to 270 (purple)
      const saturation = 70 + progress * 20;
      const lightness = 55 + Math.sin(progress * Math.PI) * 15;
      const alpha = 0.15 + Math.sin(progress * Math.PI) * 0.2;

      ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
      ctx.lineWidth = 1 + Math.sin(progress * Math.PI) * 0.5;

      for (let j = 0; j <= segmentCount; j++) {
        const x = (j / segmentCount) * w;
        const xNorm = j / segmentCount;

        // Multiple sine waves combined for organic movement
        const wave1 = Math.sin(xNorm * 4 + this.time * 0.3 + progress * 3) * 30;
        const wave2 = Math.sin(xNorm * 7 - this.time * 0.2 + progress * 2) * 15;
        const wave3 = Math.sin(xNorm * 2 + this.time * 0.15 + progress * 5) * 20;

        // Mouse influence — waves bend toward cursor
        const dx = x / w - mx;
        const dy = (centerY + yOffset) / h - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mouseInfluence = Math.max(0, 1 - dist * 2) * 25;
        const mouseWave = mouseInfluence * Math.sin(xNorm * 3 + this.time * 0.5);

        const y = centerY + yOffset + wave1 + wave2 + wave3 + mouseWave;

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
      w / 2, h / 2, h * 0.4
    );
    glowGrad.addColorStop(0, 'rgba(99, 102, 241, 0.03)');
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
