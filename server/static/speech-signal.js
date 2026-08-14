(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FluentMeSpeechSignal = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /*
   * Evidence boundary
   * -----------------
   * This module describes acoustic evidence present in one PCM sample buffer.
   * It does not decide whether pronunciation, phonemes, an accent, fluency, or
   * emotion are "correct". RMS/dBFS depends on device gain, distance, browser
   * processing, and noise. Energy-threshold pauses can confuse quiet speech or
   * breath with silence. Pitch confidence measures periodicity only: whispers
   * and unvoiced sounds have no reliable fundamental frequency, and octave
   * errors remain possible. Speaking-rate helpers require externally observed
   * word/syllable counts; they do not infer them from audio.
   */

  const DEFAULT_DB_FLOOR = -120;
  const EPSILON = 1e-12;
  const EVIDENCE_LIMITATIONS = Object.freeze({
    loudness: "Digital level is relative to full scale, not calibrated sound pressure or vocal effort.",
    pauses: "Pause boundaries are energy-threshold estimates and may include breath, noise, or quiet speech.",
    pitch: "Pitch confidence measures waveform periodicity, not pronunciation or intonation quality; octave errors are possible.",
    rate: "Speaking rates require externally supplied counts and do not validate ASR, syllables, or phonemes.",
    waveform: "Downsampled bins are a display summary and cannot support phoneme-level judgments.",
  });

  function assertSamples(samples) {
    if (samples == null || typeof samples.length !== "number" || samples.length < 0) {
      throw new TypeError("samples must be an Array or typed array");
    }
  }

  function assertSampleRate(sampleRate) {
    const value = Number(sampleRate);
    if (!Number.isFinite(value) || value <= 0) throw new RangeError("sampleRate must be positive");
    return value;
  }

  function finiteSample(samples, index) {
    const value = Number(samples[index]);
    if (!Number.isFinite(value)) return 0;
    return Math.max(-1, Math.min(1, value));
  }

  function positiveOption(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function round(value, digits = 6) {
    if (!Number.isFinite(value)) return value;
    const scale = 10 ** digits;
    return Math.round((value + Number.EPSILON) * scale) / scale;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function percentile(values, percent) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = clamp(Number(percent), 0, 100) / 100 * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function rms(samples, start = 0, end = samples?.length ?? 0) {
    assertSamples(samples);
    const from = clamp(Math.trunc(Number(start) || 0), 0, samples.length);
    const to = clamp(Math.trunc(Number(end) || 0), from, samples.length);
    if (to <= from) return 0;
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      const value = finiteSample(samples, index);
      sum += value * value;
    }
    return Math.sqrt(sum / (to - from));
  }

  function rmsToDbfs(value, floorDb = DEFAULT_DB_FLOOR) {
    const floor = Number.isFinite(Number(floorDb)) ? Number(floorDb) : DEFAULT_DB_FLOOR;
    const magnitude = clamp(Number(value) || 0, 0, 1);
    if (magnitude <= EPSILON) return floor;
    return Math.max(floor, 20 * Math.log10(magnitude));
  }

  function dbfs(samples, start = 0, end = samples?.length ?? 0, floorDb = DEFAULT_DB_FLOOR) {
    return rmsToDbfs(rms(samples, start, end), floorDb);
  }

  function frameStarts(sampleCount, frameSize, hopSize, includePartial) {
    if (!sampleCount) return [];
    if (sampleCount <= frameSize) return [0];
    const starts = [];
    for (let start = 0; start + frameSize <= sampleCount; start += hopSize) starts.push(start);
    if (includePartial) {
      const tailStart = Math.max(0, sampleCount - frameSize);
      if (starts[starts.length - 1] !== tailStart) starts.push(tailStart);
    }
    return starts;
  }

  function rmsEnvelope(samples, sampleRate, options = {}) {
    assertSamples(samples);
    const rate = assertSampleRate(sampleRate);
    const frameMs = positiveOption(options.frameMs, 20);
    const hopMs = positiveOption(options.hopMs, 10);
    const frameSize = Math.max(1, Math.round(rate * frameMs / 1000));
    const hopSize = Math.max(1, Math.round(rate * hopMs / 1000));
    const floorDb = Number.isFinite(Number(options.floorDb)) ? Number(options.floorDb) : DEFAULT_DB_FLOOR;
    const starts = frameStarts(samples.length, frameSize, hopSize, options.includePartial !== false);
    const frames = starts.map((startSample, index) => {
      const endSample = Math.min(samples.length, startSample + frameSize);
      const level = rms(samples, startSample, endSample);
      return {
        index,
        startSample,
        endSample,
        startSec: round(startSample / rate),
        endSec: round(endSample / rate),
        timeSec: round(((startSample + endSample) / 2) / rate),
        rms: level,
        dbfs: rmsToDbfs(level, floorDb),
      };
    });
    return {
      sampleRate: rate,
      sampleCount: samples.length,
      durationSec: round(samples.length / rate),
      frameSize,
      hopSize,
      frameMs: round(frameSize / rate * 1000, 3),
      hopMs: round(hopSize / rate * 1000, 3),
      floorDb,
      frames,
      evidence: "RMS energy of normalized PCM frames",
      limitation: EVIDENCE_LIMITATIONS.loudness,
    };
  }

  function groupSilentFrames(frames, silentMask) {
    const runs = [];
    let runStart = -1;
    for (let index = 0; index <= frames.length; index += 1) {
      const silent = index < frames.length && silentMask[index];
      if (silent && runStart < 0) runStart = index;
      if (!silent && runStart >= 0) {
        const endIndex = index - 1;
        const first = frames[runStart];
        const last = frames[endIndex];
        runs.push({
          startIndex: runStart,
          endIndex,
          startSec: first.startSec,
          endSec: last.endSec,
          durationSec: round(Math.max(0, last.endSec - first.startSec)),
        });
        runStart = -1;
      }
    }
    return runs;
  }

  function detectSilenceAndPauses(envelope, options = {}) {
    const frames = Array.isArray(envelope) ? envelope : envelope?.frames;
    if (!Array.isArray(frames)) throw new TypeError("envelope must be an rmsEnvelope result or frame array");
    const thresholdDbfs = Number.isFinite(Number(options.thresholdDbfs)) ? Number(options.thresholdDbfs) : -42;
    const minSilenceSec = positiveOption(options.minSilenceMs, 120) / 1000;
    const minPauseSec = positiveOption(options.minPauseMs, 250) / 1000;
    const silentMask = frames.map(frame => !Number.isFinite(frame?.dbfs) || frame.dbfs <= thresholdDbfs);
    const firstSpeechIndex = silentMask.findIndex(silent => !silent);
    let lastSpeechIndex = -1;
    for (let index = silentMask.length - 1; index >= 0; index -= 1) {
      if (!silentMask[index]) {
        lastSpeechIndex = index;
        break;
      }
    }
    const rawRuns = groupSilentFrames(frames, silentMask);
    const silenceRegions = rawRuns
      .filter(region => region.durationSec + EPSILON >= minSilenceSec)
      .map(region => {
        let kind = "internal";
        if (firstSpeechIndex < 0) kind = "all";
        else if (region.endIndex < firstSpeechIndex) kind = "leading";
        else if (region.startIndex > lastSpeechIndex) kind = "trailing";
        return { ...region, kind };
      });
    const pauses = silenceRegions
      .filter(region => region.kind === "internal" && region.durationSec + EPSILON >= minPauseSec)
      .map(region => ({ ...region, kind: "pause" }));
    const durationSec = Number.isFinite(envelope?.durationSec)
      ? envelope.durationSec
      : frames.length ? Math.max(...frames.map(frame => Number(frame.endSec) || 0)) : 0;
    const silenceDurationSec = silenceRegions.reduce((sum, region) => sum + region.durationSec, 0);
    const pauseDurationSec = pauses.reduce((sum, region) => sum + region.durationSec, 0);
    return {
      thresholdDbfs,
      minSilenceMs: round(minSilenceSec * 1000, 3),
      minPauseMs: round(minPauseSec * 1000, 3),
      silenceRegions,
      pauses,
      pauseCount: pauses.length,
      silenceDurationSec: round(silenceDurationSec),
      pauseDurationSec: round(pauseDurationSec),
      longestPauseSec: round(Math.max(0, ...pauses.map(region => region.durationSec))),
      estimatedActiveDurationSec: round(Math.max(0, durationSec - silenceDurationSec)),
      evidence: `Frames at or below ${thresholdDbfs} dBFS`,
      limitation: EVIDENCE_LIMITATIONS.pauses,
    };
  }

  function copyAndDecimate(samples, sampleRate, maxAnalysisRate) {
    const factor = Math.max(1, Math.floor(sampleRate / maxAnalysisRate));
    const length = Math.ceil(samples.length / factor);
    const output = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      const start = index * factor;
      const end = Math.min(samples.length, start + factor);
      let sum = 0;
      for (let cursor = start; cursor < end; cursor += 1) sum += finiteSample(samples, cursor);
      output[index] = sum / Math.max(1, end - start);
    }
    return { samples: output, sampleRate: sampleRate / factor, factor };
  }

  function unavailablePitch(reason, level, analysisSampleRate, decimationFactor) {
    return {
      hz: null,
      candidateHz: null,
      confidence: 0,
      voiced: false,
      periodSamples: null,
      rms: level,
      dbfs: rmsToDbfs(level),
      reason,
      method: "YIN cumulative mean normalized difference",
      analysisSampleRate,
      decimationFactor,
      limitation: EVIDENCE_LIMITATIONS.pitch,
    };
  }

  function estimatePitch(samples, sampleRate, options = {}) {
    assertSamples(samples);
    const originalRate = assertSampleRate(sampleRate);
    const minHz = positiveOption(options.minHz, 75);
    const maxHz = positiveOption(options.maxHz, 500);
    if (minHz >= maxHz) throw new RangeError("minHz must be lower than maxHz");
    const maxAnalysisRate = positiveOption(options.maxAnalysisRate, 12000);
    const prepared = copyAndDecimate(samples, originalRate, maxAnalysisRate);
    const values = prepared.samples;
    const rate = prepared.sampleRate;
    if (!values.length) return unavailablePitch("insufficient_samples", 0, rate, prepared.factor);

    let mean = 0;
    for (let index = 0; index < values.length; index += 1) mean += values[index];
    mean /= values.length;
    let energy = 0;
    for (let index = 0; index < values.length; index += 1) {
      values[index] -= mean;
      energy += values[index] * values[index];
    }
    const level = Math.sqrt(energy / values.length);
    const rmsFloor = positiveOption(options.rmsFloor, 0.006);
    if (level < rmsFloor) return unavailablePitch("low_energy", level, rate, prepared.factor);

    const minLag = Math.max(2, Math.floor(rate / maxHz));
    const maxLag = Math.min(Math.floor(rate / minHz), Math.floor(values.length / 2));
    if (maxLag <= minLag + 1) return unavailablePitch("insufficient_samples", level, rate, prepared.factor);

    const difference = new Float64Array(maxLag + 1);
    const normalized = new Float64Array(maxLag + 1);
    normalized[0] = 1;
    let cumulative = 0;
    for (let lag = 1; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let index = 0; index < values.length - lag; index += 1) {
        const delta = values[index] - values[index + lag];
        sum += delta * delta;
      }
      difference[lag] = sum;
      cumulative += sum;
      normalized[lag] = cumulative > EPSILON ? sum * lag / cumulative : 1;
    }

    const yinThreshold = clamp(Number(options.yinThreshold) || 0.15, 0.01, 0.9);
    let selectedLag = -1;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      if (normalized[lag] >= yinThreshold) continue;
      selectedLag = lag;
      while (selectedLag + 1 <= maxLag && normalized[selectedLag + 1] < normalized[selectedLag]) {
        selectedLag += 1;
      }
      break;
    }
    if (selectedLag < 0) {
      selectedLag = minLag;
      for (let lag = minLag + 1; lag <= maxLag; lag += 1) {
        if (normalized[lag] < normalized[selectedLag]) selectedLag = lag;
      }
    }

    let refinedLag = selectedLag;
    if (selectedLag > 1 && selectedLag < maxLag) {
      const left = normalized[selectedLag - 1];
      const center = normalized[selectedLag];
      const right = normalized[selectedLag + 1];
      const denominator = left - 2 * center + right;
      if (Math.abs(denominator) > EPSILON) {
        refinedLag += clamp(0.5 * (left - right) / denominator, -1, 1);
      }
    }

    const candidateHz = rate / refinedLag;
    const confidence = clamp(1 - normalized[selectedLag], 0, 1);
    const minConfidence = clamp(Number(options.minConfidence) || 0.65, 0, 1);
    const inRange = candidateHz >= minHz && candidateHz <= maxHz;
    const voiced = inRange && confidence >= minConfidence;
    return {
      hz: voiced ? round(candidateHz, 3) : null,
      candidateHz: round(candidateHz, 3),
      confidence: round(confidence),
      voiced,
      periodSamples: round(refinedLag, 3),
      rms: level,
      dbfs: rmsToDbfs(level),
      reason: voiced ? "periodic" : "low_confidence",
      method: "YIN cumulative mean normalized difference",
      analysisSampleRate: rate,
      decimationFactor: prepared.factor,
      limitation: EVIDENCE_LIMITATIONS.pitch,
    };
  }

  function copySegment(samples, start, end) {
    const output = new Float64Array(Math.max(0, end - start));
    for (let index = start; index < end; index += 1) output[index - start] = finiteSample(samples, index);
    return output;
  }

  function pitchContour(samples, sampleRate, options = {}) {
    assertSamples(samples);
    const rate = assertSampleRate(sampleRate);
    const frameMs = positiveOption(options.frameMs, 50);
    const hopMs = positiveOption(options.hopMs, 25);
    const frameSize = Math.max(1, Math.round(rate * frameMs / 1000));
    const hopSize = Math.max(1, Math.round(rate * hopMs / 1000));
    const starts = frameStarts(samples.length, frameSize, hopSize, options.includePartial !== false);
    const frames = starts.map((startSample, index) => {
      const endSample = Math.min(samples.length, startSample + frameSize);
      const estimate = estimatePitch(copySegment(samples, startSample, endSample), rate, options);
      return {
        index,
        startSample,
        endSample,
        timeSec: round(((startSample + endSample) / 2) / rate),
        hz: estimate.hz,
        candidateHz: estimate.candidateHz,
        confidence: estimate.confidence,
        voiced: estimate.voiced,
        rms: estimate.rms,
        dbfs: estimate.dbfs,
        reason: estimate.reason,
      };
    });
    const voiced = frames.filter(frame => frame.voiced && Number.isFinite(frame.hz));
    const pitches = voiced.map(frame => frame.hz);
    const lowHz = percentile(pitches, 10);
    const highHz = percentile(pitches, 90);
    return {
      sampleRate: rate,
      frameSize,
      hopSize,
      frames,
      voicedFrames: voiced.length,
      voicedFraction: frames.length ? round(voiced.length / frames.length) : 0,
      medianHz: round(median(pitches), 3),
      lowHz: round(lowHz, 3),
      highHz: round(highHz, 3),
      rangeSemitones: lowHz > 0 && highHz > 0 ? round(12 * Math.log2(highHz / lowHz), 3) : null,
      medianConfidence: round(median(voiced.map(frame => frame.confidence))),
      evidence: "Periodic-frame fundamental-frequency candidates",
      limitation: EVIDENCE_LIMITATIONS.pitch,
    };
  }

  function dynamicRange(envelope, options = {}) {
    const frames = Array.isArray(envelope) ? envelope : envelope?.frames;
    if (!Array.isArray(frames)) throw new TypeError("envelope must be an rmsEnvelope result or frame array");
    const activityThresholdDbfs = Number.isFinite(Number(options.activityThresholdDbfs))
      ? Number(options.activityThresholdDbfs)
      : -55;
    const lowerPercentile = clamp(Number(options.lowerPercentile) || 10, 0, 100);
    const upperPercentile = clamp(Number(options.upperPercentile) || 90, lowerPercentile, 100);
    const levels = frames
      .map(frame => Number(frame?.dbfs))
      .filter(level => Number.isFinite(level) && level > activityThresholdDbfs);
    if (!levels.length) {
      return {
        activeFrames: 0,
        lowerDbfs: null,
        upperDbfs: null,
        medianDbfs: null,
        peakDbfs: null,
        rangeDb: null,
        activityThresholdDbfs,
        evidence: "Percentile span of active RMS frames",
        limitation: EVIDENCE_LIMITATIONS.loudness,
      };
    }
    const lower = percentile(levels, lowerPercentile);
    const upper = percentile(levels, upperPercentile);
    return {
      activeFrames: levels.length,
      lowerPercentile,
      upperPercentile,
      lowerDbfs: round(lower, 3),
      upperDbfs: round(upper, 3),
      medianDbfs: round(median(levels), 3),
      peakDbfs: round(Math.max(...levels), 3),
      rangeDb: round(Math.max(0, upper - lower), 3),
      activityThresholdDbfs,
      evidence: "Percentile span of active RMS frames",
      limitation: EVIDENCE_LIMITATIONS.loudness,
    };
  }

  function countOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function durationOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function ratePerMinute(count, durationSec, options = {}) {
    const units = countOrNull(count);
    const duration = durationOrNull(durationSec);
    const minCount = Math.max(0, Number(options.minCount) || 1);
    const minDurationSec = Math.max(0, Number(options.minDurationSec) || 0.5);
    if (units == null || duration == null || units < minCount || duration < minDurationSec) return null;
    return round(units / duration * 60, Number.isInteger(options.digits) ? options.digits : 1);
  }

  function speakingRates(input = {}) {
    const wordCount = countOrNull(input.wordCount);
    const syllableCount = countOrNull(input.syllableCount);
    const durationSec = durationOrNull(input.durationSec);
    const activeDurationSec = durationOrNull(input.activeDurationSec);
    return {
      wordCount,
      syllableCount,
      durationSec,
      activeDurationSec,
      wordsPerMinute: ratePerMinute(wordCount, durationSec, input),
      articulationWordsPerMinute: ratePerMinute(wordCount, activeDurationSec, input),
      syllablesPerSecond: syllableCount != null && activeDurationSec != null && syllableCount > 0
        ? round(syllableCount / activeDurationSec, 2)
        : null,
      evidence: "Externally supplied unit counts divided by observed duration",
      limitation: EVIDENCE_LIMITATIONS.rate,
    };
  }

  function downsampleWaveform(samples, maxPoints = 120) {
    assertSamples(samples);
    const requested = Math.max(1, Math.min(4096, Math.trunc(Number(maxPoints) || 120)));
    const binCount = Math.min(samples.length, requested);
    if (!binCount) {
      return {
        sourceSampleCount: 0,
        binCount: 0,
        bins: [],
        evidence: "Min/max/mean/RMS summaries of PCM bins",
        limitation: EVIDENCE_LIMITATIONS.waveform,
      };
    }
    const bins = [];
    for (let index = 0; index < binCount; index += 1) {
      const startSample = Math.floor(index * samples.length / binCount);
      const endSample = Math.max(startSample + 1, Math.floor((index + 1) * samples.length / binCount));
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let sumSquares = 0;
      for (let cursor = startSample; cursor < endSample; cursor += 1) {
        const value = finiteSample(samples, cursor);
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
        sumSquares += value * value;
      }
      const count = endSample - startSample;
      bins.push({
        index,
        startSample,
        endSample,
        min: round(min),
        max: round(max),
        mean: round(sum / count),
        rms: round(Math.sqrt(sumSquares / count)),
      });
    }
    return {
      sourceSampleCount: samples.length,
      binCount,
      bins,
      evidence: "Min/max/mean/RMS summaries of PCM bins",
      limitation: EVIDENCE_LIMITATIONS.waveform,
    };
  }

  return {
    EVIDENCE_LIMITATIONS,
    rms,
    rmsToDbfs,
    dbfs,
    rmsEnvelope,
    detectSilenceAndPauses,
    estimatePitch,
    pitchContour,
    dynamicRange,
    ratePerMinute,
    speakingRates,
    downsampleWaveform,
  };
});
