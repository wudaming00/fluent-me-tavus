import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const Analysis = require("../server/static/analysis-core.js");

test("tokenizes contractions and multilingual words without splitting apostrophes", () => {
  assert.deepEqual(
    Analysis.tokenize("I’m proud of café projects — 真的."),
    ["i’m", "proud", "of", "café", "projects", "真的"],
  );
});

test("reports timing evidence without turning it into a score", () => {
  const result = Analysis.summarizeTurn({
    text: "I built the first version and tested it with real users today",
    durationSec: 6,
  });
  assert.equal(result.wordCount, 12);
  assert.equal(result.wpm, 120);
  assert.equal(result.paceLabel, "Conversational");
  assert.equal(result.availability.phonemes, false);
  assert.deepEqual(result.sources, ["Tavus transcript", "Tavus speaking duration"]);
});

test("withholds WPM for a short sample", () => {
  const result = Analysis.summarizeTurn({ text: "That works", durationSec: 1.5 });
  assert.equal(result.wpm, null);
  assert.equal(result.paceLabel, "Not enough timing data");
  assert.equal(result.availability.duration, false);
});

test("separates strong filled pauses from possible discourse markers", () => {
  const result = Analysis.summarizeTurn({
    text: "Um, I mean, I I built it, you know, with customers",
    durationSec: 8,
  });
  assert.equal(result.strongFillers, 1);
  assert.equal(result.possibleDiscourseMarkers, 2);
  assert.equal(result.repeatedWords, 1);
});

test("normalizes millisecond-style durations defensively", () => {
  assert.equal(Analysis.secondsFrom(4200), 4.2);
  assert.equal(Analysis.secondsFrom(4.2), 4.2);
  assert.equal(Analysis.secondsFrom(0), null);
});

test("compares attempts with ordered target coverage", () => {
  const first = Analysis.summarizeTurn({ text: "let me about project proud", durationSec: 4 });
  const second = Analysis.summarizeTurn({ text: "let me tell you about a project I am proud of", durationSec: 5 });
  const result = Analysis.compareAttempts(first, second, "Let me tell you about a project I am proud of");
  assert.equal(result.firstCoverage, 45);
  assert.equal(result.secondCoverage, 100);
  assert.equal(result.coverageChange, 55);
});

test("aggregates only descriptive session evidence", () => {
  const result = Analysis.aggregateSession([
    { role: "user", text: "Um I built a useful product with my team", durationSec: 4 },
    { role: "coach", text: "Tell me more", durationSec: 2 },
    { role: "user", text: "We tested it with five real customers", durationSec: 3.5 },
  ]);
  assert.equal(result.spokenTurns, 2);
  assert.equal(result.fillers, 1);
  assert.equal(result.words, 16);
  assert.equal(result.durationSec, 7.5);
  assert.equal(typeof result.medianWpm, "number");
});
