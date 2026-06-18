(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const state = {
    analyzer: null,
    chart: null,
    ws: null,
    deviceId: null,
    running: false,
    isSilent: false,
    silenceEnteredAt: null,
    lastSnapshotTime: 0,
    lastWsSendTime: 0,
    snapshotInterval: 5000,
    wsSendInterval: 120,
    snapshotCount: 0,
    mixLocalWeight: 0.6,
    remoteMerged: null,
    localResult: null,
    peerCount: 0,
  };

  const els = {
    bg: $('ambient-bg'),
    overlay: $('ambient-overlay'),
    btnStart: $('btn-start'),
    btnStop: $('btn-stop'),
    btnToggleReplay: $('btn-toggle-replay'),
    btnClear: $('btn-clear'),
    statusIndicator: $('status-indicator'),
    statusText: $('status-text'),
    emotionLabel: $('emotion-label'),
    colorPreview: $('color-preview'),
    colorHex: $('color-hex'),
    canvasSpectrum: $('canvas-spectrum'),
    canvasWaveform: $('canvas-waveform'),
    barLow: $('bar-low'),
    barMid: $('bar-mid'),
    barHigh: $('bar-high'),
    valLow: $('val-low'),
    valMid: $('val-mid'),
    valHigh: $('val-high'),
    replayPanel: $('replay-panel'),
    replayRange: $('replay-range'),
    btnRefreshReplay: $('btn-refresh-replay'),
    btnPlayReplay: $('btn-play-replay'),
    canvasReplay: $('canvas-replay'),
    replayCount: $('replay-count'),
    replaySpan: $('replay-span'),
    statEnergy: $('stat-energy'),
    statDominance: $('stat-dominance'),
    statSnapshots: $('stat-snapshots'),
    statLastUpload: $('stat-last-upload'),
    wsStatus: $('ws-status'),
    peersCount: $('peers-count'),
    peersList: $('peers-list'),
    mixSlider: $('mix-slider'),
    mixValue: $('mix-value'),
    legendLocal: $('.legend-local'),
    legendRemote: $('.legend-remote'),
    legendResult: $('.legend-result'),
  };

  let ctxSpec, ctxWave;
  let cssSpecW, cssSpecH, cssWaveW, cssWaveH;

  function initCanvases() {
    const dpr = window.devicePixelRatio || 1;

    const specRect = els.canvasSpectrum.getBoundingClientRect();
    els.canvasSpectrum.width = specRect.width * dpr;
    els.canvasSpectrum.height = specRect.height * dpr;
    ctxSpec = els.canvasSpectrum.getContext('2d');
    ctxSpec.scale(dpr, dpr);
    cssSpecW = specRect.width;
    cssSpecH = specRect.height;

    const waveRect = els.canvasWaveform.getBoundingClientRect();
    els.canvasWaveform.width = waveRect.width * dpr;
    els.canvasWaveform.height = waveRect.height * dpr;
    ctxWave = els.canvasWaveform.getContext('2d');
    ctxWave.scale(dpr, dpr);
    cssWaveW = waveRect.width;
    cssWaveH = waveRect.height;
  }

  function setStatus(type, text) {
    els.statusIndicator.className = 'status-indicator status-' + type;
    els.statusText.textContent = text;
  }

  function rgbToHex(r, g, b) {
    const toHex = n => String(Math.round(n)).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function drawSpectrum(freqData) {
    if (!ctxSpec) return;
    ctxSpec.clearRect(0, 0, cssSpecW, cssSpecH);

    const n = freqData.length;
    const barW = cssSpecW / Math.min(n, 128);
    const step = Math.floor(n / 128) || 1;

    for (let i = 0; i < 128; i++) {
      const idx = i * step;
      if (idx >= n) break;
      const value = freqData[idx] / 255;
      const barH = Math.max(1, value * cssSpecH);
      const x = i * barW;
      const y = cssSpecH - barH;

      const ratio = i / 128;
      let hue;
      if (ratio < 0.15) hue = 0 + ratio / 0.15 * 25;
      else if (ratio < 0.6) hue = 25 + (ratio - 0.15) / 0.45 * 220;
      else hue = 220 + (ratio - 0.6) / 0.4 * 140;

      const grad = ctxSpec.createLinearGradient(0, y, 0, cssSpecH);
      grad.addColorStop(0, `hsla(${hue}, 95%, 65%, 0.95)`);
      grad.addColorStop(1, `hsla(${hue}, 90%, 40%, 0.6)`);
      ctxSpec.fillStyle = grad;
      ctxSpec.fillRect(x + 0.5, y, barW - 1, barH);
    }
  }

  function drawWaveform(timeData) {
    if (!ctxWave) return;
    ctxWave.clearRect(0, 0, cssWaveW, cssWaveH);

    ctxWave.lineWidth = 2;
    ctxWave.strokeStyle = 'rgba(106, 255, 200, 0.9)';
    ctxWave.beginPath();

    const n = timeData.length;
    const step = Math.max(1, Math.floor(n / cssWaveW));

    for (let x = 0; x < cssWaveW; x++) {
      const idx = x * step;
      if (idx >= n) break;
      const v = timeData[idx] / 128 - 1;
      const y = cssWaveH / 2 + v * (cssWaveH / 2);
      if (x === 0) ctxWave.moveTo(x, y);
      else ctxWave.lineTo(x, y);
    }
    ctxWave.stroke();

    ctxWave.lineWidth = 1;
    ctxWave.strokeStyle = 'rgba(106, 255, 200, 0.2)';
    ctxWave.beginPath();
    ctxWave.moveTo(0, cssWaveH / 2);
    ctxWave.lineTo(cssWaveW, cssWaveH / 2);
    ctxWave.stroke();
  }

  function updateBandBars(result) {
    const { features } = result;
    const { low, mid, high } = features.band_ratios;
    const total = low + mid + high || 1;
    const lowPct = (low / total) * 100;
    const midPct = (mid / total) * 100;
    const highPct = (high / total) * 100;

    els.barLow.style.width = `${lowPct.toFixed(1)}%`;
    els.barMid.style.width = `${midPct.toFixed(1)}%`;
    els.barHigh.style.width = `${highPct.toFixed(1)}%`;
    els.valLow.textContent = `${Math.round(lowPct)}%`;
    els.valMid.textContent = `${Math.round(midPct)}%`;
    els.valHigh.textContent = `${Math.round(highPct)}%`;
  }

  function updateUI(result) {
    const { features, rgb, hsl, emotion_label, dominance, is_silent, silence_duration_ms } = result;
    state.localResult = result;

    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    els.colorPreview.style.background = hex;
    els.colorHex.textContent = hex.toUpperCase();
    els.emotionLabel.textContent = emotion_label;

    let outputRgb = rgb;
    let outputHsl = hsl;
    let outputEmotion = emotion_label;

    if (state.remoteMerged && !is_silent) {
      const localW = state.mixLocalWeight;
      const remoteW = 1 - localW;
      const mixed = window.EmotionModel.blendColorWeighted(
        { r: rgb.r, g: rgb.g, b: rgb.b },
        state.remoteMerged.rgb,
        localW
      );
      outputRgb = mixed.rgb;
      outputHsl = mixed.hsl;
      outputEmotion = outputEmotion + ' × 融合';
    }

    if (is_silent) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 800);
      els.bg.style.background =
        `radial-gradient(ellipse at 30% 20%, rgba(80,80,100,${0.15 + pulse * 0.1}) 0%,
         rgba(50,50,70,${0.1 + pulse * 0.08}) 30%,
         rgb(20,20,30) 70%,
         rgb(8,8,16) 100%)`;
      updateBandBars({ features: { band_ratios: { low: 0, mid: 0, high: 0 } } });
      els.statDominance.textContent = '静默';
      els.emotionLabel.style.color = 'rgba(180,180,200,0.7)';
    } else {
      const bgGrad = `radial-gradient(ellipse at 30% 20%, hsla(${outputHsl.h}, ${outputHsl.s}%, ${Math.min(outputHsl.l + 10, 80)}%, 0.6) 0%,
                  hsla(${outputHsl.h}, ${outputHsl.s}%, ${Math.min(outputHsl.l + 5, 65)}%, 0.4) 30%,
                  hsl(${outputHsl.h}, ${outputHsl.s}%, ${Math.max(outputHsl.l - 20, 10)}%) 70%,
                  hsl(${outputHsl.h}, ${Math.max(outputHsl.s - 10, 10)}%, ${Math.max(outputHsl.l - 35, 5)}%) 100%)`;
      els.bg.style.background = bgGrad;
      updateBandBars(result);
      els.statDominance.textContent = { low: '低频', mid: '中频', high: '高频' }[dominance] || '—';
      els.emotionLabel.style.color = '';
    }

    els.statEnergy.textContent = (features.overall_energy * 100).toFixed(0);
    updateLegendColors(outputRgb);
  }

  async function uploadSnapshot(result) {
    if (result.is_silent) return null;
    const { features, rgb, hsl, emotion_label, dominance } = result;
    const payload = {
      timestamp: Date.now(),
      low_mean: features.low_mean,
      mid_peak: features.mid_peak,
      high_variance: features.high_variance,
      overall_energy: features.overall_energy,
      dominance,
      emotion_label,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      h: hsl.h,
      s: hsl.s,
      l: hsl.l,
    };

    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = await res.json();
        state.snapshotCount++;
        els.statSnapshots.textContent = state.snapshotCount;
        const now = new Date();
        els.statLastUpload.textContent =
          String(now.getHours()).padStart(2, '0') + ':' +
          String(now.getMinutes()).padStart(2, '0') + ':' +
          String(now.getSeconds()).padStart(2, '0');
        return json;
      }
    } catch (err) {
      console.warn('上传快照失败:', err);
    }
    return null;
  }

  async function handleFrame({ frequencyData, rawFrequency, timeDomainData }) {
    const now = Date.now();
    const result = window.EmotionModel.processAudioFrame(frequencyData, now);
    updateUI(result);
    drawSpectrum(rawFrequency);
    drawWaveform(timeDomainData);

    if (result.is_silent !== state.isSilent) {
      state.isSilent = result.is_silent;
      if (result.is_silent) {
        state.silenceEnteredAt = now;
        setStatus('silent', '静默中（已暂停记录）');
      } else {
        state.silenceEnteredAt = null;
        setStatus('active', '采集中');
      }
    }

    if (now - state.lastSnapshotTime >= state.snapshotInterval) {
      state.lastSnapshotTime = now;
      uploadSnapshot(result);
    }

    if (state.ws && state.ws.isConnected && now - state.lastWsSendTime >= state.wsSendInterval) {
      state.lastWsSendTime = now;
      state.ws.sendColor(result);
    }
  }

  async function start() {
    try {
      setStatus('active', '正在初始化...');
      state.analyzer = new window.AudioAnalyzer();
      state.analyzer.onFrame = handleFrame;
      await state.analyzer.start();
      state.running = true;
      state.isSilent = false;
      state.silenceEnteredAt = null;
      state.lastSnapshotTime = Date.now();
      setStatus('active', '采集中');
      els.btnStart.disabled = true;
      els.btnStop.disabled = false;
    } catch (err) {
      setStatus('error', '失败: ' + err.message);
      console.error(err);
    }
  }

  function stop() {
    if (state.analyzer) {
      state.analyzer.stop();
      state.analyzer = null;
    }
    state.running = false;
    state.isSilent = false;
    state.silenceEnteredAt = null;
    setStatus('idle', '已停止');
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
  }

  async function fetchHistory() {
    const range = parseInt(els.replayRange.value, 10);
    let url = '/api/snapshots';
    if (range > 0) {
      const end = Date.now();
      const start = end - range;
      url += `?start=${start}&end=${end}`;
    } else {
      url += '?limit=5000';
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('网络错误');
      const json = await res.json();
      state.chart.setData(json.data);
      els.replayCount.textContent = json.count;
      if (json.data.length >= 2) {
        const span = json.data[json.data.length - 1].timestamp - json.data[0].timestamp;
        els.replaySpan.textContent = formatDuration(span);
      } else {
        els.replaySpan.textContent = '—';
      }
    } catch (err) {
      console.warn('获取历史数据失败:', err);
      alert('获取历史数据失败: ' + err.message);
    }
  }

  function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}小时${m}分${sec}秒`;
    if (m > 0) return `${m}分${sec}秒`;
    return `${sec}秒`;
  }

  function toggleReplayPanel() {
    const hidden = els.replayPanel.classList.toggle('hidden');
    if (!hidden) {
      if (!state.chart) {
        state.chart = new window.HistoryChart(els.canvasReplay);
      }
      fetchHistory();
    }
  }

  function togglePlayReplay() {
    if (!state.chart) return;
    if (state.chart.isPlaying) {
      state.chart.stopPlayback();
      els.btnPlayReplay.textContent = '▶️ 自动播放';
    } else {
      els.btnPlayReplay.textContent = '⏸️ 暂停';
      state.chart.startPlayback((item, idx, total) => {
        const hex = rgbToHex(item.r, item.g, item.b);
        els.colorPreview.style.background = hex;
        els.colorHex.textContent = hex.toUpperCase();
        els.emotionLabel.textContent = item.emotion_label;
        els.bg.style.background =
          `radial-gradient(ellipse at 30% 20%, hsla(${item.h}, ${item.s}%, ${Math.min(item.l + 10, 80)}%, 0.6) 0%,
           hsla(${item.h}, ${item.s}%, ${Math.min(item.l + 5, 65)}%, 0.4) 30%,
           hsl(${item.h}, ${item.s}%, ${Math.max(item.l - 20, 10)}%) 70%,
           hsl(${item.h}, ${Math.max(item.s - 10, 10)}%, ${Math.max(item.l - 35, 5)}%) 100%)`;
        els.statEnergy.textContent = (item.overall_energy * 100).toFixed(0);
        els.statDominance.textContent = { low: '低频', mid: '中频', high: '高频' }[item.dominance] || '—';
        if (idx >= total) {
          els.btnPlayReplay.textContent = '▶️ 自动播放';
        }
      }, 80);
    }
  }

  async function clearData() {
    if (!confirm('确定要清空所有历史情绪快照吗？此操作不可恢复。')) return;
    try {
      const res = await fetch('/api/snapshots', { method: 'DELETE' });
      if (res.ok) {
        state.snapshotCount = 0;
        els.statSnapshots.textContent = '0';
        if (state.chart) state.chart.clear();
        els.replayCount.textContent = '0';
        els.replaySpan.textContent = '—';
        alert('已清空所有快照数据');
      }
    } catch (err) {
      alert('清空失败: ' + err.message);
    }
  }

  function initWS() {
    if (state.ws) return;
    const ws = new window.MoodLightWS(`ws://${window.location.host}/ws`);
    state.ws = ws;

    ws.onConnect = (deviceId) => {
      state.deviceId = deviceId;
      els.wsStatus.textContent = '● 在线';
      els.wsStatus.classList.remove('ws-disconnected');
      els.wsStatus.classList.add('ws-connected');
    };

    ws.onDisconnect = () => {
      els.wsStatus.textContent = '● 离线';
      els.wsStatus.classList.remove('ws-connected');
      els.wsStatus.classList.add('ws-disconnected');
      state.remoteMerged = null;
      state.peerCount = 0;
      els.peersCount.textContent = '0';
      renderPeers([]);
    };

    ws.onPeerJoin = (peer) => {
      state.peerCount++;
      els.peersCount.textContent = state.peerCount;
    };

    ws.onPeerLeave = (peerId) => {
      state.peerCount = Math.max(0, state.peerCount - 1);
      els.peersCount.textContent = state.peerCount;
    };

    ws.onStateUpdate = (stateData) => {
      const { peers, merged_color } = stateData;
      state.peerCount = peers.filter(p => p.id !== state.deviceId).length;
      els.peersCount.textContent = state.peerCount;

      if (merged_color && state.peerCount > 0) {
        state.remoteMerged = {
          rgb: { r: merged_color.r, g: merged_color.g, b: merged_color.b },
        };
      } else {
        state.remoteMerged = null;
      }

      renderPeers(peers.filter(p => p.id !== state.deviceId));
    };

    ws.connect();
  }

  function renderPeers(peers) {
    if (!peers || peers.length === 0) {
      els.peersList.innerHTML = '<div class="peer-empty">暂无其他设备在线</div>';
      return;
    }
    const html = peers.map(p => {
      const color = p.color ? `rgb(${p.color.r}, ${p.color.g}, ${p.color.b})` : '#555';
      const emotion = p.emotion_label || '—';
      const energyPct = p.overall_energy ? Math.min(100, p.overall_energy * 100).toFixed(0) : 0;
      const shortId = p.id ? p.id.slice(0, 8) : '----';
      return `
        <div class="peer-card">
          <div class="peer-top">
            <div class="peer-color-dot" style="background: ${color}"></div>
            <div class="peer-info">
              <div class="peer-emotion">${emotion}</div>
              <div class="peer-id">#${shortId}</div>
            </div>
          </div>
          <div class="peer-energy-bar">
            <div class="peer-energy-fill" style="width: ${energyPct}%"></div>
          </div>
          <div class="peer-stats">
            <span>能量 ${energyPct}%</span>
            <span>${p.is_silent ? '静默' : '活跃'}</span>
          </div>
        </div>
      `;
    }).join('');
    els.peersList.innerHTML = html;
  }

  function updateLegendColors(outputRgb) {
    const outColor = `rgb(${Math.round(outputRgb.r)}, ${Math.round(outputRgb.g)}, ${Math.round(outputRgb.b)})`;
    const localColor = state.localResult
      ? `rgb(${Math.round(state.localResult.rgb.r)}, ${Math.round(state.localResult.rgb.g)}, ${Math.round(state.localResult.rgb.b)})`
      : '#6a9cff';
    const remoteColor = state.remoteMerged
      ? `rgb(${Math.round(state.remoteMerged.rgb.r)}, ${Math.round(state.remoteMerged.rgb.g)}, ${Math.round(state.remoteMerged.rgb.b)})`
      : '#6affa0';

    const localDot = document.querySelector('.legend-local');
    const remoteDot = document.querySelector('.legend-remote');
    const resultDot = document.querySelector('.legend-result');
    if (localDot) localDot.style.background = localColor;
    if (remoteDot) remoteDot.style.background = remoteColor;
    if (resultDot) resultDot.style.background = outColor;
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', start);
    els.btnStop.addEventListener('click', stop);
    els.btnToggleReplay.addEventListener('click', toggleReplayPanel);
    els.btnClear.addEventListener('click', clearData);
    els.btnRefreshReplay.addEventListener('click', fetchHistory);
    els.btnPlayReplay.addEventListener('click', togglePlayReplay);

    els.mixSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state.mixLocalWeight = val / 100;
      els.mixValue.textContent = val + '%';
      if (state.localResult) {
        updateUI(state.localResult);
      }
    });

    window.addEventListener('resize', () => {
      initCanvases();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCanvases();
    bindEvents();
    initWS();
    setStatus('idle', '准备就绪，请点击"启动麦克风"');
  });
})();
