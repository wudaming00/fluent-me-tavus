(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FluentMeAnalysis = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STRONG_FILLERS = new Set(["um", "umm", "uh", "uhh", "erm", "er", "hmm"]);
  const DISCOURSE_MARKERS = [
    ["you", "know"],
    ["i", "mean"],
    ["kind", "of"],
    ["sort", "of"],
  ];

  function tokenize(text) {
    return String(text || "")
      .toLocaleLowerCase("en")
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  }

  function secondsFrom(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 600 ? value / 1000 : value;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function countSequence(tokens, sequence) {
    let count = 0;
    for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
      if (sequence.every((token, offset) => tokens[index + offset] === token)) count += 1;
    }
    return count;
  }

  function lexicalSignals(text) {
    const tokens = tokenize(text);
    const strongFillers = tokens.reduce((count, token) => count + Number(STRONG_FILLERS.has(token)), 0);
    const possibleDiscourseMarkers = DISCOURSE_MARKERS.reduce(
      (count, sequence) => count + countSequence(tokens, sequence),
      0,
    );
    let repeatedWords = 0;
    for (let index = 1; index < tokens.length; index += 1) {
      if (tokens[index] === tokens[index - 1] && !STRONG_FILLERS.has(tokens[index])) repeatedWords += 1;
    }
    return { tokens, wordCount: tokens.length, strongFillers, possibleDiscourseMarkers, repeatedWords };
  }

  function paceLabel(wpm) {
    if (!Number.isFinite(wpm)) return "Not enough timing data";
    if (wpm < 80) return "Spacious";
    if (wpm < 116) return "Measured";
    if (wpm <= 165) return "Conversational";
    return "Fast-moving";
  }

  function eventKeysMatch(leftKeys = [], rightKeys = [], ageMs = Infinity, fallbackWindowMs = 5000) {
    const left = Array.isArray(leftKeys) ? leftKeys.filter(Boolean).map(String) : [];
    const right = Array.isArray(rightKeys) ? rightKeys.filter(Boolean).map(String) : [];
    if (left.length && right.length) return left.some(key => right.includes(key));
    return Number.isFinite(Number(ageMs)) && Number(ageMs) >= 0 && Number(ageMs) < fallbackWindowMs;
  }

  function summarizeTurn(input = {}) {
    const text = String(input.text || "").trim();
    const lexical = lexicalSignals(text);
    const durationSec = secondsFrom(input.durationSec ?? input.duration ?? input.durationMs);
    const enoughTiming = lexical.wordCount >= 5 && durationSec >= 2;
    const wpm = enoughTiming ? Math.round((lexical.wordCount / durationSec) * 60) : null;
    const fillerRate = lexical.wordCount
      ? Math.round((lexical.strongFillers / lexical.wordCount) * 1000) / 10
      : null;
    const signal = input.signalAnalysis;
    return {
      text,
      durationSec,
      interrupted: Boolean(input.interrupted),
      wordCount: lexical.wordCount,
      wpm,
      paceLabel: paceLabel(wpm),
      strongFillers: lexical.strongFillers,
      fillerRatePer100: fillerRate,
      possibleDiscourseMarkers: lexical.possibleDiscourseMarkers,
      repeatedWords: lexical.repeatedWords,
      audioObservation: input.audioAnalysis || "",
      visualObservation: input.visualAnalysis || "",
      availability: {
        transcript: Boolean(text),
        duration: Boolean(enoughTiming),
        wordTimestamps: false,
        rawAudio: false,
        phonemes: false,
        acousticSignal: Boolean(signal?.available),
        waveform: Boolean(signal?.available && signal?.waveform?.bins?.length),
        pitchContour: Boolean(signal?.available && signal?.pitch?.voicedFrames),
      },
      sources: [
        ...(text ? ["Tavus transcript"] : []),
        ...(enoughTiming ? ["Tavus speaking duration"] : []),
        ...(signal?.available ? ["Browser microphone signal"] : []),
        ...(input.audioAnalysis || input.visualAnalysis ? ["Raven qualitative observation"] : []),
      ],
    };
  }

  function longestCommonSubsequence(left, right) {
    const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = 1; i <= left.length; i += 1) {
      for (let j = 1; j <= right.length; j += 1) {
        rows[i][j] = left[i - 1] === right[j - 1]
          ? rows[i - 1][j - 1] + 1
          : Math.max(rows[i - 1][j], rows[i][j - 1]);
      }
    }
    return rows[left.length][right.length];
  }

  function transcriptCoverage(target, attempt) {
    const targetTokens = tokenize(target);
    const attemptTokens = tokenize(attempt);
    if (!targetTokens.length) return null;
    const matched = longestCommonSubsequence(targetTokens, attemptTokens);
    return Math.round((matched / targetTokens.length) * 100);
  }

  function compareAttempts(firstInput, secondInput, target = "") {
    const first = firstInput?.wordCount != null ? firstInput : summarizeTurn(firstInput);
    const second = secondInput?.wordCount != null ? secondInput : summarizeTurn(secondInput);
    const firstCoverage = target ? transcriptCoverage(target, first.text) : null;
    const secondCoverage = target ? transcriptCoverage(target, second.text) : null;
    return {
      first,
      second,
      firstCoverage,
      secondCoverage,
      wpmChange: Number.isFinite(first.wpm) && Number.isFinite(second.wpm) ? second.wpm - first.wpm : null,
      fillerChange: second.strongFillers - first.strongFillers,
      repetitionChange: second.repeatedWords - first.repeatedWords,
      coverageChange: Number.isFinite(firstCoverage) && Number.isFinite(secondCoverage)
        ? secondCoverage - firstCoverage
        : null,
    };
  }

  function aggregateSession(turns = []) {
    const summaries = turns
      .filter(turn => !turn.role || turn.role === "user")
      .map(turn => turn.metrics?.wordCount != null ? turn.metrics : summarizeTurn(turn));
    const words = summaries.reduce((sum, item) => sum + item.wordCount, 0);
    const durationSec = summaries.reduce((sum, item) => sum + (item.durationSec || 0), 0);
    const fillers = summaries.reduce((sum, item) => sum + item.strongFillers, 0);
    const repeatedWords = summaries.reduce((sum, item) => sum + item.repeatedWords, 0);
    return {
      spokenTurns: summaries.length,
      words,
      durationSec: Math.round(durationSec * 10) / 10,
      medianWpm: Math.round(median(summaries.map(item => item.wpm)) || 0) || null,
      fillers,
      fillerRatePer100: words ? Math.round((fillers / words) * 1000) / 10 : null,
      repeatedWords,
      interruptions: summaries.filter(item => item.interrupted).length,
    };
  }

  return {
    tokenize,
    secondsFrom,
    lexicalSignals,
    paceLabel,
    eventKeysMatch,
    summarizeTurn,
    transcriptCoverage,
    compareAttempts,
    aggregateSession,
  };
});
