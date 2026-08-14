import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const Signal = require("../server/static/speech-signal.js");

function sine({ hz, sampleRate, seconds, amplitude = 0.5, phase = 0 }) {
  const output = new Float32Array(Math.round(sampleRate * seconds));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = amplitude * Math.sin(2 * Math.PI * hz * index / sampleRate + phase);
  }
  return output;
}

function concat(...arrays) {
  const output = new Float32Array(arrays.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of arrays) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}

function constant(length, value) {
  return new Float32Array(length).fill(value);
}

test("exports a CommonJS API and the browser-style global", () => {
  assert.equal(globalThis.FluentMeSpeechSignal, Signal);
  assert.equal(typeof Signal.estimatePitch, "function");
  assert.equal(typeof Signal.downsampleWaveform, "function");
});

test("computes RMS and dBFS against normalized digital full scale", () => {
  assert.equal(Signal.rms(new Float32Array(8)), 0);
  assert.equal(Signal.dbfs(new Float32Array(8)), -120);
  assert.ok(Math.abs(Signal.rms(constant(8, 0.5)) - 0.5) < 1e-9);
  assert.ok(Math.abs(Signal.rmsToDbfs(0.5) - (-6.020599913)) < 1e-6);
});

test("sanitizes non-finite and over-range PCM samples deterministically", () => {
  const level = Signal.rms([Infinity, NaN, 2, -2]);
  assert.ok(Math.abs(level - Math.sqrt(0.5)) < 1e-12);
  assert.equal(Signal.rmsToDbfs(5), 0);
});

test("builds a timed RMS envelope with one anchored tail frame", () => {
  const samples = concat(constant(50, 0), constant(45, 1));
  const envelope = Signal.rmsEnvelope(samples, 1000, { frameMs: 20, hopMs: 20 });
  assert.equal(envelope.durationSec, 0.095);
  assert.equal(envelope.frameSize, 20);
  assert.equal(envelope.hopSize, 20);
  assert.deepEqual(envelope.frames.map(frame => frame.startSample), [0, 20, 40, 60, 75]);
  assert.equal(envelope.frames.at(-1).endSample, 95);
  assert.ok(envelope.frames[2].rms > 0 && envelope.frames[2].rms < 1);
});

test("detects only interior long silence as a pause", () => {
  const sampleRate = 1000;
  const samples = concat(
    constant(100, 0),
    constant(200, 0.5),
    constant(300, 0),
    constant(200, 0.5),
    constant(100, 0),
  );
  const envelope = Signal.rmsEnvelope(samples, sampleRate, { frameMs: 20, hopMs: 10 });
  const result = Signal.detectSilenceAndPauses(envelope, {
    thresholdDbfs: -30,
    minSilenceMs: 60,
    minPauseMs: 200,
  });
  assert.equal(result.pauseCount, 1);
  assert.equal(result.pauses[0].kind, "pause");
  assert.ok(result.pauses[0].durationSec >= 0.28 && result.pauses[0].durationSec <= 0.32);
  assert.deepEqual(result.silenceRegions.map(region => region.kind), ["leading", "internal", "trailing"]);
  assert.ok(result.estimatedActiveDurationSec > 0.35 && result.estimatedActiveDurationSec < 0.45);
});

test("does not call an all-silent utterance a conversational pause", () => {
  const envelope = Signal.rmsEnvelope(new Float32Array(400), 1000, { frameMs: 20, hopMs: 10 });
  const result = Signal.detectSilenceAndPauses(envelope, { minSilenceMs: 100, minPauseMs: 200 });
  assert.equal(result.pauseCount, 0);
  assert.equal(result.silenceRegions.length, 1);
  assert.equal(result.silenceRegions[0].kind, "all");
  assert.equal(result.estimatedActiveDurationSec, 0);
});

test("estimates a clean fundamental with high periodicity confidence", () => {
  const estimate = Signal.estimatePitch(sine({ hz: 200, sampleRate: 8000, seconds: 0.1 }), 8000);
  assert.equal(estimate.voiced, true);
  assert.ok(Math.abs(estimate.hz - 200) < 0.5, `estimated ${estimate.hz}`);
  assert.ok(estimate.confidence > 0.98, `confidence ${estimate.confidence}`);
  assert.equal(estimate.reason, "periodic");
});

test("decimates high-rate audio before pitch analysis without changing the estimate", () => {
  const estimate = Signal.estimatePitch(sine({ hz: 220, sampleRate: 48000, seconds: 0.08 }), 48000);
  assert.equal(estimate.decimationFactor, 4);
  assert.equal(estimate.analysisSampleRate, 12000);
  assert.ok(Math.abs(estimate.hz - 220) < 1);
});

test("withholds pitch for silence and exposes the reason", () => {
  const estimate = Signal.estimatePitch(new Float32Array(800), 8000);
  assert.equal(estimate.voiced, false);
  assert.equal(estimate.hz, null);
  assert.equal(estimate.confidence, 0);
  assert.equal(estimate.reason, "low_energy");
});

test("withholds pitch from deterministic aperiodic noise at a strict confidence threshold", () => {
  let seed = 123456789;
  const noise = new Float32Array(1600);
  for (let index = 0; index < noise.length; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    noise[index] = ((seed / 0xffffffff) * 2 - 1) * 0.35;
  }
  const estimate = Signal.estimatePitch(noise, 8000, { minConfidence: 0.8 });
  assert.equal(estimate.voiced, false);
  assert.equal(estimate.hz, null);
  assert.ok(estimate.confidence < 0.8);
});

test("returns a pitch contour with voiced coverage and descriptive range", () => {
  const samples = concat(
    sine({ hz: 200, sampleRate: 8000, seconds: 0.2 }),
    new Float32Array(1600),
    sine({ hz: 250, sampleRate: 8000, seconds: 0.2 }),
  );
  const contour = Signal.pitchContour(samples, 8000, { frameMs: 50, hopMs: 50 });
  assert.ok(contour.voicedFrames >= 6);
  assert.ok(contour.voicedFraction > 0.5 && contour.voicedFraction < 0.8);
  assert.ok(contour.lowHz >= 195 && contour.lowHz <= 205);
  assert.ok(contour.highHz >= 245 && contour.highHz <= 255);
  assert.ok(contour.rangeSemitones > 3 && contour.rangeSemitones < 5);
});

test("measures dynamic range from active frame percentiles, excluding silence", () => {
  const frames = [
    { dbfs: -120 },
    ...Array.from({ length: 10 }, () => ({ dbfs: Signal.rmsToDbfs(0.1) })),
    ...Array.from({ length: 10 }, () => ({ dbfs: Signal.rmsToDbfs(0.5) })),
  ];
  const result = Signal.dynamicRange(frames, { activityThresholdDbfs: -60 });
  assert.equal(result.activeFrames, 20);
  assert.ok(Math.abs(result.rangeDb - 13.979) < 0.01, `range ${result.rangeDb}`);
  assert.equal(result.peakDbfs, -6.021);
});

test("returns unavailable dynamic range when no frame clears the activity floor", () => {
  const result = Signal.dynamicRange([{ dbfs: -120 }, { dbfs: -80 }], { activityThresholdDbfs: -60 });
  assert.equal(result.activeFrames, 0);
  assert.equal(result.rangeDb, null);
});

test("computes speaking and articulation rates only from supplied counts", () => {
  const rates = Signal.speakingRates({
    wordCount: 24,
    syllableCount: 36,
    durationSec: 12,
    activeDurationSec: 9,
  });
  assert.equal(rates.wordsPerMinute, 120);
  assert.equal(rates.articulationWordsPerMinute, 160);
  assert.equal(rates.syllablesPerSecond, 4);
  assert.equal(Signal.ratePerMinute(0, 10), null);
  assert.equal(Signal.ratePerMinute(5, 0), null);
});

test("downsamples waveform into deterministic min/max/RMS bins without losing impulses", () => {
  const waveform = Signal.downsampleWaveform([0, 1, -1, 0, 0.5, -0.5, 0, 0], 2);
  assert.equal(waveform.binCount, 2);
  assert.deepEqual(
    waveform.bins.map(bin => ({ start: bin.startSample, end: bin.endSample, min: bin.min, max: bin.max })),
    [
      { start: 0, end: 4, min: -1, max: 1 },
      { start: 4, end: 8, min: -0.5, max: 0.5 },
    ],
  );
  assert.equal(waveform.bins[0].rms, 0.707107);
});

test("rejects invalid sample rates instead of manufacturing measurements", () => {
  assert.throws(() => Signal.rmsEnvelope([0, 1], 0), /sampleRate/);
  assert.throws(() => Signal.estimatePitch([0, 1], -1), /sampleRate/);
  assert.throws(() => Signal.estimatePitch([0, 1], 8000, { minHz: 500, maxHz: 100 }), /minHz/);
});

test("documents evidence limitations without exporting pronunciation or phoneme scores", () => {
  assert.match(Signal.EVIDENCE_LIMITATIONS.pitch, /not pronunciation/);
  assert.match(Signal.EVIDENCE_LIMITATIONS.rate, /do not validate/);
  assert.equal("pronunciationScore" in Signal, false);
  assert.equal("phonemeScore" in Signal, false);
});
