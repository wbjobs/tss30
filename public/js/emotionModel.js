(function (global) {
  'use strict';

  const FREQ_BANDS = {
    LOW: { min: 0, max: 0.15, label: 'low' },
    MID: { min: 0.15, max: 0.6, label: 'mid' },
    HIGH: { min: 0.6, max: 1.0, label: 'high' },
  };

  const EMOTIONS = {
    FIERCE: { label: '激昂', color: { h: 0, s: 85, l: 55 } },
    ENERGETIC: { label: '活力', color: { h: 25, s: 90, l: 58 } },
    HAPPY: { label: '欢快', color: { h: 50, s: 95, l: 60 } },
    ANXIOUS: { label: '焦躁', color: { h: 60, s: 90, l: 55 } },
    CALM: { label: '舒缓', color: { h: 210, s: 70, l: 60 } },
    PEACEFUL: { label: '宁静', color: { h: 180, s: 60, l: 65 } },
    MELANCHOLY: { label: '忧郁', color: { h: 260, s: 55, l: 50 } },
    MYSTERIOUS: { label: '神秘', color: { h: 300, s: 65, l: 48 } },
    NEUTRAL: { label: '平静', color: { h: 140, s: 40, l: 60 } },
  };

  function splitFrequencyBands(frequencyData) {
    const n = frequencyData.length;
    const bands = {
      low: [],
      mid: [],
      high: [],
    };
    for (let i = 0; i < n; i++) {
      const ratio = i / n;
      const value = frequencyData[i];
      if (ratio >= FREQ_BANDS.LOW.min && ratio < FREQ_BANDS.LOW.max) {
        bands.low.push(value);
      } else if (ratio >= FREQ_BANDS.MID.min && ratio < FREQ_BANDS.MID.max) {
        bands.mid.push(value);
      } else if (ratio >= FREQ_BANDS.HIGH.min && ratio <= FREQ_BANDS.HIGH.max) {
        bands.high.push(value);
      }
    }
    return bands;
  }

  function mean(arr) {
    if (!arr.length) return 0;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function peak(arr) {
    if (!arr.length) return 0;
    let m = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > m) m = arr[i];
    }
    return m;
  }

  function variance(arr) {
    if (!arr.length) return 0;
    const m = mean(arr);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - m;
      sum += d * d;
    }
    return sum / arr.length;
  }

  function normalize(value, max) {
    return Math.min(1, Math.max(0, value / max));
  }

  function extractFeatures(frequencyData) {
    const bands = splitFrequencyBands(frequencyData);
    const lowMean = mean(bands.low);
    const midPeak = peak(bands.mid);
    const highVar = variance(bands.high);

    const totalEnergy = mean(frequencyData);
    const lowRatio = bands.low.length ? mean(bands.low) / (totalEnergy + 1e-6) : 0;
    const midRatio = bands.mid.length ? mean(bands.mid) / (totalEnergy + 1e-6) : 0;
    const highRatio = bands.high.length ? mean(bands.high) / (totalEnergy + 1e-6) : 0;

    return {
      low_mean: normalize(lowMean, 255),
      mid_peak: normalize(midPeak, 255),
      high_variance: normalize(highVar, 255 * 255),
      overall_energy: normalize(totalEnergy, 255),
      band_ratios: {
        low: lowRatio,
        mid: midRatio,
        high: highRatio,
      },
    };
  }

  function determineDominance(features) {
    const { low, mid, high } = features.band_ratios;
    if (low >= mid && low >= high) return 'low';
    if (mid >= low && mid >= high) return 'mid';
    return 'high';
  }

  function blendHSL(c1, c2, t) {
    return {
      h: c1.h + (c2.h - c1.h) * t,
      s: c1.s + (c2.s - c1.s) * t,
      l: c1.l + (c2.l - c1.l) * t,
    };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1, g1, b1;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  }

  function computeEmotionColor(features) {
    const { low_mean, mid_peak, high_variance, overall_energy, band_ratios } = features;
    const energy = overall_energy;
    const { low, mid, high } = band_ratios;

    let targetEmotion;
    let blendFactor = 0;
    let blendEmotion = null;

    if (energy > 0.7) {
      if (low > mid && low > high) {
        targetEmotion = EMOTIONS.FIERCE;
        if (high > 0.25) {
          blendEmotion = EMOTIONS.ANXIOUS;
          blendFactor = Math.min(1, high_variance * 1.5);
        }
      } else if (high > mid && high > low) {
        targetEmotion = EMOTIONS.ANXIOUS;
        blendEmotion = EMOTIONS.HAPPY;
        blendFactor = mid_peak;
      } else {
        targetEmotion = EMOTIONS.ENERGETIC;
        blendEmotion = EMOTIONS.HAPPY;
        blendFactor = mid_peak;
      }
    } else if (energy > 0.35) {
      if (mid > low && mid > high) {
        targetEmotion = EMOTIONS.HAPPY;
        if (low > 0.3) {
          blendEmotion = EMOTIONS.ENERGETIC;
          blendFactor = low * 0.8;
        } else if (high > 0.35) {
          blendEmotion = EMOTIONS.ANXIOUS;
          blendFactor = high_variance;
        }
      } else if (low > mid) {
        targetEmotion = EMOTIONS.MYSTERIOUS;
        blendEmotion = EMOTIONS.MELANCHOLY;
        blendFactor = (1 - energy) * 0.6;
      } else {
        targetEmotion = EMOTIONS.NEUTRAL;
        blendEmotion = EMOTIONS.CALM;
        blendFactor = 0.5;
      }
    } else {
      if (mid_peak > 0.3) {
        targetEmotion = EMOTIONS.MELANCHOLY;
        blendEmotion = EMOTIONS.CALM;
        blendFactor = (1 - mid_peak);
      } else if (high_variance > 0.3) {
        targetEmotion = EMOTIONS.MYSTERIOUS;
        blendEmotion = EMOTIONS.PEACEFUL;
        blendFactor = 0.6;
      } else {
        targetEmotion = EMOTIONS.CALM;
        blendEmotion = EMOTIONS.PEACEFUL;
        blendFactor = (1 - energy) * 0.8;
      }
    }

    let hsl = targetEmotion.color;
    if (blendEmotion) {
      hsl = blendHSL(hsl, blendEmotion.color, blendFactor);
    }

    hsl.s = hsl.s * (0.6 + energy * 0.4);
    hsl.l = 40 + energy * 30;

    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);

    return {
      hsl: {
        h: Math.round(hsl.h * 10) / 10,
        s: Math.round(hsl.s * 10) / 10,
        l: Math.round(hsl.l * 10) / 10,
      },
      rgb,
      emotion_label: targetEmotion.label,
      dominance: determineDominance(features),
    };
  }

  function processAudioFrame(frequencyData) {
    const features = extractFeatures(frequencyData);
    const emotionResult = computeEmotionColor(features);
    return {
      features,
      ...emotionResult,
    };
  }

  const EmotionModel = {
    FREQ_BANDS,
    EMOTIONS,
    extractFeatures,
    computeEmotionColor,
    processAudioFrame,
    hslToRgb,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EmotionModel;
  }
  global.EmotionModel = EmotionModel;
})(typeof window !== 'undefined' ? window : globalThis);
