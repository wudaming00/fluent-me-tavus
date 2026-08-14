import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const Visual = require("../server/static/recap-visual.js");

function generatedReview(overrides = {}) {
  return {
    source: "generated",
    grammar: ["Use the past tense in ‘I built it last year.’"],
    wordChoice: ["Use ‘tradeoff’ instead of ‘bad thing’."],
    naturalExpression: ["Try ‘The main tradeoff was speed versus control.’"],
    polishedVersion: "I built it last year.",
    coverage: {
      totalLearnerTurns: 4,
      includedLearnerTurns: 4,
      omittedLearnerTurns: 0,
    },
    ...overrides,
  };
}

function recursiveKeys(value, output = []) {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    output.push(key);
    recursiveKeys(child, output);
  }
  return output;
}

test("exports a CommonJS/UMD chart-first API", () => {
  assert.equal(typeof Visual.buildRecapVisual, "function");
  assert.equal(Visual.build, Visual.buildRecapVisual);
  assert.deepEqual(Visual.CHART_TYPES, ["gauge", "bar", "dots", "timeline"]);
});

test("an empty input renders no cards and names every hidden section", () => {
  const result = Visual.build({});
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.hiddenSections.map(item => item.id), Visual.SECTION_ORDER);
  assert.match(result.disclosure, /Only available session evidence is shown/);
});

test("pace is a neutral measurement gauge only with two supported timed turns", () => {
  assert.equal(Visual.paceSection({ paceTurns: 1, medianWpm: 135 }), null);
  assert.equal(Visual.paceSection({ paceTurns: 2, medianWpm: 0 }), null);
  assert.equal(Visual.paceSection({ paceTurns: 2, medianWpm: 401 }), null);

  const section = Visual.paceSection({ paceTurns: 4, medianWpm: 135 });
  assert.equal(section.valueLabel, "135 WPM");
  assert.equal(section.chart.type, "gauge");
  assert.equal(section.chart.value, 135);
  assert.equal(section.chart.min, 0);
  assert.equal(section.chart.max, 400);
  assert.equal(section.chart.normalized, 0.3375);
  assert.equal(section.chart.isScore, false);
  assert.match(section.chart.tooltip, /not a target, fluency judgment, or score/i);
  assert.doesNotMatch(`${section.title} ${section.summary}`, /good|bad|fast|slow/i);
});

test("zero pause counts remain visible when spoken evidence exists", () => {
  const section = Visual.pausesRhythmSection({
    spokenTurns: 3,
    filledPauses: 0,
    repeatedWords: 0,
  });
  assert.equal(section.chart.type, "dots");
  assert.deepEqual(section.chart.items.map(item => item.value), [0, 0]);
  assert.deepEqual(section.chart.items.map(item => item.normalized), [0, 0]);
  assert.match(section.chart.items[0].tooltip, /does not mean perfect fluency/i);
  assert.equal(section.chart.isScore, false);
});

test("pause evidence can add a truthful per-turn timeline without treating spacing as time", () => {
  const section = Visual.pausesRhythmSection({
    spokenTurns: 3,
    filledPauses: 2,
    repeatedWords: 1,
  }, [
    { role: "coach", signalAnalysis: { available: true, pauses: { pauseCount: 99 } } },
    { role: "user", learnerTurn: 1, signalAnalysis: { available: true, pauses: { pauseCount: 2 } } },
    { role: "user", learnerTurn: 2, signalAnalysis: { available: false, pauses: { pauseCount: 8 } } },
    { role: "user", learnerTurn: 3, signalAnalysis: { available: true, pauses: { pauseCount: 0 } } },
  ]);

  const pauseItem = section.chart.items.find(item => item.id === "internal-pauses");
  assert.equal(pauseItem.value, 2);
  assert.deepEqual(section.turnTimeline.items.map(item => item.value), [2, 0]);
  assert.deepEqual(section.turnTimeline.items.map(item => item.normalizedPosition), [0, 1]);
  assert.match(section.turnTimeline.tooltip, /does not represent elapsed time or performance/i);
});

test("dot rows cap only their visual markers and preserve the observed count", () => {
  const section = Visual.pausesRhythmSection({
    spokenTurns: 2,
    filledPauses: 25,
    repeatedWords: 0,
  });
  const item = section.chart.items[0];
  assert.equal(item.value, 25);
  assert.equal(item.dots, Visual.MAX_DOTS);
  assert.equal(item.overflow, true);
  assert.equal(item.normalized, 1);
});

test("fallback language-review placeholders never become recap findings", () => {
  const fallback = generatedReview({
    source: "fallback",
    grammar: ["No high-confidence grammar change was generated."],
    wordChoice: ["No high-confidence word-choice change was generated."],
    naturalExpression: ["No high-confidence natural-expression change was generated."],
  });
  assert.equal(Visual.grammarSection(fallback), null);
  assert.equal(Visual.wordingSection(fallback), null);

  const result = Visual.build({ languageReview: fallback });
  assert.deepEqual(result.sections, []);
  assert.ok(result.hiddenSections.some(item => item.id === "grammar"));
  assert.ok(result.hiddenSections.some(item => item.id === "wording"));
});

test("an explicit no-change result is shown as review evidence, not as a score", () => {
  const review = generatedReview({ grammar: ["No high-value change."] });
  const section = Visual.grammarSection(review);
  assert.equal(section.valueLabel, "No change surfaced");
  assert.equal(section.items.length, 0);
  assert.equal(section.chart.value, 0);
  assert.equal(section.chart.normalized, 0);
  assert.match(section.chart.tooltip, /not a grammar score, error rate, or severity measure/i);
});

test("word choice and natural expression share one bounded count bar", () => {
  const review = generatedReview({
    wordChoice: ["Choice one", "Choice two", "Choice three", "Ignored fourth"],
    naturalExpression: ["Natural one", "Natural two"],
  });
  const section = Visual.wordingSection(review);
  assert.equal(section.items.length, 5);
  assert.deepEqual(section.items.map(item => item.kind), [
    "word-choice", "word-choice", "word-choice", "natural-expression", "natural-expression",
  ]);
  assert.equal(section.chart.type, "bar");
  assert.equal(section.chart.value, 5);
  assert.equal(section.chart.max, 6);
  assert.equal(section.chart.normalized, 0.8333);
  assert.match(section.chart.tooltip, /not a naturalness score or ability rating/i);
});

test("review coverage discloses a stale snapshot without inventing findings", () => {
  const section = Visual.grammarSection({
    data: generatedReview(),
    stale: true,
    generatedTurnCount: 4,
  }, 6);
  assert.equal(section.coverage.stale, true);
  assert.equal(section.coverage.newerTurns, 2);
  assert.match(section.source, /2 turns not included/);
});

test("next practice is a timeline made only from the recap focus and retained phrase", () => {
  const section = Visual.nextPracticeSection({
    focus: "Retell the decision and result in 30 seconds.",
    phrase: "The tradeoff was worth it.",
    score: 99,
    transcript: "Do not render me",
  });
  assert.equal(section.chart.type, "timeline");
  assert.deepEqual(section.items.map(item => item.text), [
    "Retell the decision and result in 30 seconds.",
    "The tradeoff was worth it.",
  ]);
  assert.deepEqual(section.chart.items.map(item => item.normalizedPosition), [0, 1]);
  assert.doesNotMatch(JSON.stringify(section), /99|Do not render me/);
  assert.match(section.chart.tooltip, /do not predict improvement or certify mastery/i);
});

test("a representative recap produces ordered render-ready chart sections", () => {
  const result = Visual.build({
    evidence: {
      learnerTurns: 4,
      spokenTurns: 4,
      paceTurns: 3,
      medianWpm: 128,
      filledPauses: 2,
      repeatedWords: 1,
    },
    languageReview: generatedReview(),
    currentLearnerTurns: 4,
    recap: {
      focus: "Connect the decision to the result.",
      phrase: "The main tradeoff was speed versus control.",
    },
  });

  assert.deepEqual(result.sections.map(section => section.id), Visual.SECTION_ORDER);
  assert.deepEqual(result.sections.map(section => section.chart.type), [
    "gauge", "dots", "bar", "bar", "timeline",
  ]);
  assert.deepEqual(result.hiddenSections, []);
  for (const section of result.sections) assert.equal(section.chart.isScore, false);

  const keys = recursiveKeys(result).map(key => key.toLowerCase());
  assert.equal(keys.includes("score"), false);
  assert.equal(keys.includes("rating"), false);
  assert.equal(keys.includes("grade"), false);
  assert.equal(keys.includes("percentile"), false);
});

test("text and normalization helpers are bounded and deterministic", () => {
  assert.equal(Visual.cleanText("  hello\n\tworld  ", 20), "hello world");
  assert.equal(Visual.cleanText("x".repeat(500), 12), "x".repeat(12));
  assert.equal(Visual.normalizeLinear(-20, 0, 100), 0);
  assert.equal(Visual.normalizeLinear(250, 0, 100), 1);
  assert.equal(Visual.normalizeLinear(25, 0, 100), 0.25);
  assert.equal(Visual.normalizeLinear("bad", 0, 100), null);
});
