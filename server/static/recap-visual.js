(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FluentMeRecapVisual = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const PACE_AXIS_MAX_WPM = 400;
  const MAX_DOTS = 8;
  const MAX_LANGUAGE_ITEMS = 3;
  const MAX_TEXT_CHARS = 320;
  const SECTION_ORDER = Object.freeze([
    "pace",
    "pauses-rhythm",
    "grammar",
    "wording",
    "next-practice",
  ]);
  const CHART_TYPES = Object.freeze(["gauge", "bar", "dots", "timeline"]);
  const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
  const NO_CHANGE = /^no high-value change\.?$/i;

  function cleanText(value, maximum = MAX_TEXT_CHARS) {
    const limit = Math.max(0, Math.floor(Number(maximum) || 0));
    if (!limit) return "";
    return String(value ?? "")
      .slice(0, limit * 3 + 24)
      .normalize("NFKC")
      .replace(CONTROL_CHARACTERS, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit)
      .trim();
  }

  function own(object, key) {
    return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
  }

  function safeCount(value, maximum = 1_000_000) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.min(maximum, Math.floor(number));
  }

  function safePositive(value, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > maximum) return null;
    return number;
  }

  function normalizeLinear(value, minimum, maximum) {
    const number = Number(value);
    const min = Number(minimum);
    const max = Number(maximum);
    if (!Number.isFinite(number) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    const clamped = Math.max(min, Math.min(max, number));
    return Math.round(((clamped - min) / (max - min)) * 10_000) / 10_000;
  }

  function hidden(id, reason) {
    return { id, reason };
  }

  function paceSection(evidence = {}) {
    const paceTurns = safeCount(evidence.paceTurns, 10_000);
    const medianWpm = safePositive(evidence.medianWpm, PACE_AXIS_MAX_WPM);
    if (paceTurns == null || paceTurns < 2 || medianWpm == null) return null;

    const value = Math.round(medianWpm);
    const tooltip = `Median words per minute from ${paceTurns} supported timed turns. The gauge is a neutral 0–${PACE_AXIS_MAX_WPM} WPM display axis, not a target, fluency judgment, or score.`;
    return {
      id: "pace",
      eyebrow: "SPEAKING EVIDENCE",
      title: "Pace",
      valueLabel: `${value} WPM`,
      summary: `Median across ${paceTurns} timed turn${paceTurns === 1 ? "" : "s"}.`,
      tooltip,
      source: "Turn timing + transcript word count",
      chart: {
        type: "gauge",
        semantic: "measurement-axis",
        value,
        unit: "WPM",
        min: 0,
        max: PACE_AXIS_MAX_WPM,
        normalized: normalizeLinear(value, 0, PACE_AXIS_MAX_WPM),
        clamped: false,
        label: `${value} words per minute`,
        tooltip,
        isScore: false,
      },
    };
  }

  function learnerSignalTurns(turns) {
    if (!Array.isArray(turns)) return [];
    return turns.flatMap((turn, index) => {
      if (!turn || turn.role !== "user" || turn.typed || !turn.signalAnalysis?.available) return [];
      const pauseCount = safeCount(turn.signalAnalysis.pauses?.pauseCount, 10_000);
      if (pauseCount == null) return [];
      const learnerTurn = safeCount(turn.learnerTurn, 10_000) || index + 1;
      return [{ learnerTurn, pauseCount }];
    });
  }

  function dotItem({ id, label, value, source, tooltip }) {
    const count = safeCount(value, 1_000_000);
    if (count == null) return null;
    const dots = Math.min(count, MAX_DOTS);
    return {
      id,
      label,
      value: count,
      valueLabel: String(count),
      dots,
      overflow: count > MAX_DOTS,
      normalized: normalizeLinear(dots, 0, MAX_DOTS),
      source,
      tooltip,
    };
  }

  function pausesRhythmSection(evidence = {}, turns = []) {
    const spokenTurns = safeCount(evidence.spokenTurns, 10_000) || 0;
    const signalTurns = learnerSignalTurns(turns);
    const items = [];

    if (spokenTurns > 0 && own(evidence, "filledPauses")) {
      items.push(dotItem({
        id: "filled-pauses",
        label: "Filled pauses",
        value: evidence.filledPauses,
        source: "High-confidence transcript matches",
        tooltip: "Counted transcript matches such as ‘um’ or ‘uh’. Zero means none matched; it does not mean perfect fluency.",
      }));
    }
    if (spokenTurns > 0 && own(evidence, "repeatedWords")) {
      items.push(dotItem({
        id: "adjacent-repeats",
        label: "Adjacent repeats",
        value: evidence.repeatedWords,
        source: "Adjacent transcript words",
        tooltip: "Counts immediately repeated transcript words. It does not judge intentional repetition or speaking ability.",
      }));
    }

    if (signalTurns.length) {
      const internalPauses = signalTurns.reduce((sum, item) => sum + item.pauseCount, 0);
      items.push(dotItem({
        id: "internal-pauses",
        label: "Estimated internal pauses",
        value: internalPauses,
        source: `Browser microphone signal · ${signalTurns.length} observed turn${signalTurns.length === 1 ? "" : "s"}`,
        tooltip: "Estimated pauses of at least 280 ms in turns with available browser signal. Quiet speech, breath, and noise can affect this count.",
      }));
    } else {
      const internalPauses = own(evidence, "internalPauses") ? safeCount(evidence.internalPauses, 1_000_000) : null;
      const pauseTurns = own(evidence, "pauseTurns") ? safeCount(evidence.pauseTurns, 10_000) : null;
      if (internalPauses != null && pauseTurns > 0) {
        items.push(dotItem({
          id: "internal-pauses",
          label: "Estimated internal pauses",
          value: internalPauses,
          source: `Browser microphone signal · ${pauseTurns} observed turn${pauseTurns === 1 ? "" : "s"}`,
          tooltip: "Estimated pauses of at least 280 ms in turns with available browser signal. Quiet speech, breath, and noise can affect this count.",
        }));
      }
    }

    const visibleItems = items.filter(Boolean);
    if (!visibleItems.length) return null;
    const tooltip = `Each dot represents one observed event, up to ${MAX_DOTS} dots per row. Counts are descriptive and are not rhythm, fluency, or pronunciation scores.`;
    return {
      id: "pauses-rhythm",
      eyebrow: "SPEAKING EVIDENCE",
      title: "Pauses & rhythm evidence",
      valueLabel: `${visibleItems.length} signal${visibleItems.length === 1 ? "" : "s"}`,
      summary: spokenTurns
        ? `Observed across ${spokenTurns} spoken turn${spokenTurns === 1 ? "" : "s"}; dots are counts, not scores.`
        : "Only rows with available evidence are shown.",
      tooltip,
      source: "Transcript counts and available browser signal",
      chart: {
        type: "dots",
        semantic: "observed-event-counts",
        maxDots: MAX_DOTS,
        items: visibleItems,
        label: "Observed pause and repetition events",
        tooltip,
        isScore: false,
      },
      turnTimeline: signalTurns.length
        ? {
            type: "timeline",
            semantic: "observed-turns",
            items: signalTurns.map((item, index) => ({
              id: `turn-${item.learnerTurn}`,
              label: `Turn ${item.learnerTurn}`,
              value: item.pauseCount,
              valueLabel: `${item.pauseCount} pause${item.pauseCount === 1 ? "" : "s"}`,
              normalizedPosition: signalTurns.length === 1
                ? 0
                : Math.round((index / (signalTurns.length - 1)) * 10_000) / 10_000,
            })),
            label: "Turns with available microphone pause evidence",
            tooltip: "Turn order only; spacing does not represent elapsed time or performance.",
            isScore: false,
          }
        : null,
    };
  }

  function unwrapReview(input) {
    if (input?.data && typeof input.data === "object") {
      return {
        review: input.data,
        stale: Boolean(input.stale),
        generatedTurnCount: safeCount(input.generatedTurnCount, 1_000_000),
      };
    }
    return { review: input || null, stale: false, generatedTurnCount: null };
  }

  function reviewCoverage(review, meta, currentLearnerTurns) {
    const total = safeCount(review?.coverage?.totalLearnerTurns, 1_000_000);
    const included = safeCount(review?.coverage?.includedLearnerTurns, 12);
    const omitted = safeCount(review?.coverage?.omittedLearnerTurns, 1_000_000);
    const current = safeCount(currentLearnerTurns, 1_000_000);
    const snapshotTurns = total ?? meta.generatedTurnCount;
    const newerTurns = current != null && snapshotTurns != null ? Math.max(0, current - snapshotTurns) : 0;
    const stale = Boolean(meta.stale || newerTurns);
    let label = "Review coverage not reported";
    if (total != null && included != null) {
      label = omitted
        ? `Latest ${included} of ${total} learner turns`
        : `All ${included} learner turn${included === 1 ? "" : "s"}`;
    }
    if (stale) label += ` · ${newerTurns || "newer"} turn${newerTurns === 1 ? "" : "s"} not included`;
    return { total, included, omitted, newerTurns, stale, label };
  }

  function reviewItems(value) {
    if (!Array.isArray(value)) return null;
    const cleaned = value.slice(0, MAX_LANGUAGE_ITEMS).map(item => cleanText(item)).filter(Boolean);
    if (!cleaned.length) return null;
    const suggestions = cleaned.filter(item => !NO_CHANGE.test(item));
    return {
      suggestions,
      noChange: suggestions.length === 0 && cleaned.some(item => NO_CHANGE.test(item)),
    };
  }

  function itemCountBar(value, maximum, label, tooltip) {
    return {
      type: "bar",
      semantic: "bounded-suggestion-count",
      value,
      unit: "suggestions",
      min: 0,
      max: maximum,
      normalized: normalizeLinear(value, 0, maximum),
      label,
      tooltip,
      isScore: false,
    };
  }

  function grammarSection(reviewInput, currentLearnerTurns) {
    const meta = unwrapReview(reviewInput);
    const review = meta.review;
    if (!review || review.source !== "generated") return null;
    const result = reviewItems(review.grammar);
    if (!result || (!result.suggestions.length && !result.noChange)) return null;
    const coverage = reviewCoverage(review, meta, currentLearnerTurns);
    const count = result.suggestions.length;
    const summary = result.noChange
      ? "No high-value grammar change surfaced in this review."
      : `${count} high-value grammar suggestion${count === 1 ? "" : "s"} surfaced.`;
    const tooltip = `This bar counts suggestions shown in a bounded review (maximum ${MAX_LANGUAGE_ITEMS}). It is not a grammar score, error rate, or severity measure.`;
    return {
      id: "grammar",
      eyebrow: "LANGUAGE REVIEW",
      title: "Grammar",
      valueLabel: result.noChange ? "No change surfaced" : `${count} suggestion${count === 1 ? "" : "s"}`,
      summary,
      tooltip,
      source: coverage.label,
      coverage,
      items: result.suggestions.map((text, index) => ({ id: `grammar-${index + 1}`, label: `Suggestion ${index + 1}`, text })),
      chart: itemCountBar(count, MAX_LANGUAGE_ITEMS, summary, tooltip),
    };
  }

  function wordingSection(reviewInput, currentLearnerTurns) {
    const meta = unwrapReview(reviewInput);
    const review = meta.review;
    if (!review || review.source !== "generated") return null;
    const wordChoice = reviewItems(review.wordChoice);
    const naturalExpression = reviewItems(review.naturalExpression);
    if (!wordChoice && !naturalExpression) return null;

    const items = [];
    for (const [kind, label, group] of [
      ["word-choice", "Word choice", wordChoice],
      ["natural-expression", "Natural expression", naturalExpression],
    ]) {
      if (!group) continue;
      group.suggestions.forEach((text, index) => {
        items.push({ id: `${kind}-${index + 1}`, kind, label, text });
      });
    }
    const explicitNoChange = Boolean(
      (wordChoice?.noChange || wordChoice?.suggestions.length)
      && (naturalExpression?.noChange || naturalExpression?.suggestions.length)
      && !items.length
    );
    if (!items.length && !explicitNoChange) return null;

    const coverage = reviewCoverage(review, meta, currentLearnerTurns);
    const count = items.length;
    const maximum = MAX_LANGUAGE_ITEMS * 2;
    const summary = explicitNoChange
      ? "No high-value word-choice or natural-expression change surfaced."
      : `${count} wording suggestion${count === 1 ? "" : "s"} surfaced.`;
    const tooltip = `This bar counts word-choice and natural-expression suggestions shown in a bounded review (maximum ${maximum}). It is not a naturalness score or ability rating.`;
    return {
      id: "wording",
      eyebrow: "LANGUAGE REVIEW",
      title: "Word choice & naturalness",
      valueLabel: explicitNoChange ? "No change surfaced" : `${count} suggestion${count === 1 ? "" : "s"}`,
      summary,
      tooltip,
      source: coverage.label,
      coverage,
      items,
      chart: itemCountBar(count, maximum, summary, tooltip),
    };
  }

  function nextPracticeSection(recapInput) {
    const recap = recapInput?.data && typeof recapInput.data === "object" ? recapInput.data : recapInput;
    const focus = cleanText(recap?.focus, 240);
    const phrase = cleanText(recap?.phrase, 160);
    if (!focus && !phrase) return null;

    const steps = [];
    if (focus) steps.push({ id: "next-rep", label: "Next rep", text: focus });
    if (phrase) steps.push({ id: "phrase-to-reuse", label: "Phrase to reuse", text: phrase });
    const timeline = steps.map((step, index) => ({
      ...step,
      normalizedPosition: steps.length === 1
        ? 0
        : Math.round((index / (steps.length - 1)) * 10_000) / 10_000,
    }));
    const tooltip = "These steps repeat the saved recap recommendation and phrase. They do not predict improvement or certify mastery.";
    return {
      id: "next-practice",
      eyebrow: "NEXT PRACTICE",
      title: "Try one thing next",
      valueLabel: `${steps.length} step${steps.length === 1 ? "" : "s"}`,
      summary: focus || "Reuse the retained phrase in a fresh answer.",
      tooltip,
      source: "Session recap",
      items: steps,
      chart: {
        type: "timeline",
        semantic: "practice-steps",
        items: timeline,
        label: "Next practice steps",
        tooltip,
        isScore: false,
      },
    };
  }

  function buildRecapVisual(input = {}) {
    const evidence = input.evidence || input.sessionEvidence || {};
    const review = input.languageReview || input.review || null;
    const currentLearnerTurns = input.currentLearnerTurns;
    const candidates = new Map([
      ["pace", paceSection(evidence)],
      ["pauses-rhythm", pausesRhythmSection(evidence, input.turns)],
      ["grammar", grammarSection(review, currentLearnerTurns)],
      ["wording", wordingSection(review, currentLearnerTurns)],
      ["next-practice", nextPracticeSection(input.recap)],
    ]);
    const reasons = {
      pace: "needs_two_supported_timed_turns",
      "pauses-rhythm": "no_supported_pause_or_repetition_evidence",
      grammar: "generated_language_review_unavailable",
      wording: "generated_language_review_unavailable",
      "next-practice": "recap_practice_not_available",
    };
    const sections = SECTION_ORDER.map(id => candidates.get(id)).filter(Boolean);
    return {
      version: VERSION,
      sections,
      hiddenSections: SECTION_ORDER.filter(id => !candidates.get(id)).map(id => hidden(id, reasons[id])),
      disclosure: "Only available session evidence is shown. Chart positions and counts are descriptive; none is an English level, quality, fluency, pronunciation, or emotion score.",
    };
  }

  return {
    VERSION,
    PACE_AXIS_MAX_WPM,
    MAX_DOTS,
    MAX_LANGUAGE_ITEMS,
    SECTION_ORDER,
    CHART_TYPES,
    cleanText,
    normalizeLinear,
    paceSection,
    pausesRhythmSection,
    grammarSection,
    wordingSection,
    nextPracticeSection,
    buildRecapVisual,
    build: buildRecapVisual,
  };
});
