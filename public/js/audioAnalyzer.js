(function (global) {
  'use strict';

  class AudioAnalyzer {
    constructor() {
      this.audioContext = null;
      this.analyser = null;
      this.microphone = null;
      this.scriptProcessor = null;
      this.isRunning = false;
      this.fftSize = 2048;
      this.frequencyData = null;
      this.timeDomainData = null;
      this.onFrame = null;
      this._rafId = null;
      this._smoothedFrequency = null;
      this._smoothFactor = 0.85;
    }

    async start() {
      if (this.isRunning) return;

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('浏览器不支持 getUserMedia API');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('浏览器不支持 Web Audio API');
        }

        this.audioContext = new AudioContextClass();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = this.fftSize;
        this.analyser.smoothingTimeConstant = 0.7;

        this.microphone = this.audioContext.createMediaStreamSource(stream);
        this.microphone.connect(this.analyser);

        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        this.timeDomainData = new Uint8Array(this.analyser.fftSize);
        this._smoothedFrequency = new Float32Array(this.analyser.frequencyBinCount);

        this.isRunning = true;
        this._stream = stream;
        this._startLoop();
        return true;
      } catch (err) {
        this.stop();
        throw err;
      }
    }

    stop() {
      this.isRunning = false;

      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }

      if (this._stream) {
        this._stream.getTracks().forEach(t => t.stop());
        this._stream = null;
      }

      if (this.microphone) {
        try { this.microphone.disconnect(); } catch (e) {}
        this.microphone = null;
      }
      if (this.analyser) {
        try { this.analyser.disconnect(); } catch (e) {}
        this.analyser = null;
      }
      if (this.audioContext) {
        try { this.audioContext.close(); } catch (e) {}
        this.audioContext = null;
      }
    }

    _startLoop() {
      const loop = () => {
        if (!this.isRunning) return;

        this.analyser.getByteFrequencyData(this.frequencyData);
        this.analyser.getByteTimeDomainData(this.timeDomainData);

        for (let i = 0; i < this.frequencyData.length; i++) {
          this._smoothedFrequency[i] =
            this._smoothedFrequency[i] * this._smoothFactor +
            this.frequencyData[i] * (1 - this._smoothFactor);
        }

        if (typeof this.onFrame === 'function') {
          this.onFrame({
            frequencyData: this._smoothedFrequency,
            rawFrequency: this.frequencyData,
            timeDomainData: this.timeDomainData,
          });
        }

        this._rafId = requestAnimationFrame(loop);
      };
      this._rafId = requestAnimationFrame(loop);
    }
  }

  global.AudioAnalyzer = AudioAnalyzer;
})(typeof window !== 'undefined' ? window : globalThis);
