(function (global) {
  'use strict';

  class HistoryChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.data = [];
      this.isPlaying = false;
      this._playIndex = 0;
      this._playTimer = null;
      this._resizeHandler = this._resize.bind(this);
      this._initCanvas();
      window.addEventListener('resize', this._resizeHandler);
    }

    _initCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.ctx.scale(dpr, dpr);
      this._cssWidth = rect.width;
      this._cssHeight = rect.height;
      this.draw();
    }

    _resize() {
      this._initCanvas();
    }

    setData(data) {
      this.data = Array.isArray(data) ? data : [];
      this.stopPlayback();
      this._playIndex = 0;
      this.draw();
    }

    clear() {
      this.data = [];
      this.stopPlayback();
      this.draw();
    }

    startPlayback(callback, intervalMs = 100) {
      this.stopPlayback();
      if (!this.data.length) return;
      this._playIndex = 0;
      this.isPlaying = true;
      this._playTimer = setInterval(() => {
        if (this._playIndex >= this.data.length) {
          this.stopPlayback();
          return;
        }
        const item = this.data[this._playIndex];
        this._playIndex++;
        this.draw(this._playIndex);
        if (typeof callback === 'function') {
          callback(item, this._playIndex, this.data.length);
        }
      }, intervalMs);
    }

    stopPlayback() {
      this.isPlaying = false;
      if (this._playTimer) {
        clearInterval(this._playTimer);
        this._playTimer = null;
      }
    }

    draw(highlightCount) {
      const { ctx, _cssWidth: W, _cssHeight: H } = this;
      const padL = 40, padR = 12, padT = 16, padB = 32;
      const chartW = W - padL - padR;
      const chartH = H - padT - padB;

      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(padL, padT, chartW, chartH);

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(200,200,255,0.5)';

      for (let i = 0; i <= 4; i++) {
        const y = padT + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + chartW, y);
        ctx.stroke();
        const val = (1 - i / 4).toFixed(2);
        ctx.textAlign = 'right';
        ctx.fillText(val, padL - 6, y + 3);
      }

      if (!this.data.length) {
        ctx.fillStyle = 'rgba(150,150,200,0.5)';
        ctx.font = '13px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无历史数据', W / 2, H / 2);
        return;
      }

      const n = this.data.length;
      const getX = (i) => padL + (chartW * i) / Math.max(1, n - 1);
      const getY = (val) => padT + chartH * (1 - Math.min(1, Math.max(0, val)));

      for (let i = 0; i < n; i++) {
        const x = getX(i);
        const snap = this.data[i];
        const r = snap.r / 255, g = snap.g / 255, b = snap.b / 255;
        const color = `rgb(${snap.r},${snap.g},${snap.b})`;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, padT + chartH);
        ctx.lineTo(x, getY(snap.overall_energy));
        ctx.stroke();

        const dotR = i < (highlightCount || n) ? 2.5 : 1.5;
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, getY(snap.overall_energy), dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(padL, padT, chartW, chartH);

      if (n >= 2) {
        const startTime = this.data[0].timestamp;
        const endTime = this.data[n - 1].timestamp;
        const span = endTime - startTime;
        ctx.fillStyle = 'rgba(150,150,200,0.6)';
        ctx.textAlign = 'left';
        ctx.fillText(this._fmtTime(startTime), padL, H - 10);
        ctx.textAlign = 'right';
        ctx.fillText(this._fmtTime(endTime), padL + chartW, H - 10);
        if (span > 0) {
          ctx.textAlign = 'center';
          ctx.fillText(`时长: ${this._fmtDuration(span)}`, W / 2, H - 10);
        }
      }

      const labels = ['激昂', '活力', '欢快', '焦躁', '舒缓', '宁静', '忧郁', '神秘', '平静'];
      const palette = ['#ff4444', '#ff8844', '#ffdd44', '#ffee44', '#44aaff', '#44dddd', '#8866cc', '#cc66cc', '#66cc99'];
      const legendX = padL;
      const legendY = padT - 8;
      ctx.font = '9px -apple-system, sans-serif';
      labels.forEach((label, i) => {
        const lx = legendX + i * 70;
        if (lx + 60 > padL + chartW) return;
        ctx.fillStyle = palette[i];
        ctx.fillRect(lx, legendY - 6, 10, 10);
        ctx.fillStyle = 'rgba(200,200,255,0.6)';
        ctx.textAlign = 'left';
        ctx.fillText(label, lx + 14, legendY + 2);
      });
    }

    _fmtTime(ts) {
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    _fmtDuration(ms) {
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (h > 0) return `${h}h${m}m${sec}s`;
      if (m > 0) return `${m}m${sec}s`;
      return `${sec}s`;
    }

    destroy() {
      this.stopPlayback();
      window.removeEventListener('resize', this._resizeHandler);
    }
  }

  global.HistoryChart = HistoryChart;
})(typeof window !== 'undefined' ? window : globalThis);
