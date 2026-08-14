import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const Progress = require("../server/static/progress-core.js");

const NOW = Date.parse("2026-08-14T19:00:00.000Z");

function session(overrides = {}) {
  return {
    id: "session-one",
    endedAt: NOW - Progress.DAY_MS,
    durationSec: 600,
    timedSeconds: 180,
    learnerTurns: 8,
    ...overrides,
  };
}

function card(overrides = {}) {
  return {
    id: "card-one",
    phrase: "Let me frame the problem.",
    dueAt: NOW,
    reviewStep: 0,
    lastReviewedAt: null,
    ...overrides,
  };
}

test("empty data produces zero metrics and a truthful first-step message", () => {
  const result = Progress.summarize({}, {}, { now: NOW, timeZone: "UTC" });

  assert.deepEqual(result.metrics, {
    totalSessions: 0,
    timedSpeakingSeconds: 0,
    learnerTurns: 0,
    practiceDays7: 0,
    savedPhrases: 0,
    duePhrases: 0,
  });
  assert.equal(result.activityDays.length, 7);
  assert.equal(result.review.stages.length, 6);
  assert.equal(result.feedback.headline, "Your progress starts with one real turn.");
  assert.doesNotMatch(JSON.stringify(result), /score|streak|% improved|ability/i);
});

test("completed sessions aggregate only bounded timed speaking and learner turns", () => {
  const result = Progress.summarize({
    sessions: [
      session(),
      session({ id: "session-two", endedAt: NOW, durationSec: 60, timedSeconds: 999, learnerTurns: 3 }),
    ],
  }, { cards: [] }, { now: NOW, timeZone: "UTC" });

  assert.equal(result.metrics.totalSessions, 2);
  assert.equal(result.metrics.timedSpeakingSeconds, 240);
  assert.equal(result.metrics.learnerTurns, 11);
  assert.equal(result.metrics.practiceDays7, 2);
  assert.match(result.feedback.detail, /2 saved session recaps/);
  assert.match(result.feedback.detail, /4 min of timed speaking/);
  assert.match(result.feedback.detail, /11 learner turns/);
});

test("malformed and hostile fields are dropped, deduplicated, or bounded", () => {
  const result = Progress.summarize({
    secret: "sk_should_not_escape",
    sessions: [
      null,
      { endedAt: -1, durationSec: 500, timedSeconds: 400, learnerTurns: 2 },
      session({ id: "same", durationSec: 99_999_999, timedSeconds: 99_999_999, learnerTurns: 99_999_999, transcript: "private transcript" }),
      session({ id: "same", endedAt: NOW - 2000, transcript: "duplicate" }),
    ],
  }, {
    apiKey: "private",
    cards: [
      null,
      card({ phrase: "", dueAt: NOW }),
      card({ id: "first", phrase: "Keep it simple!", reviewStep: 99, waveform: [1, 2] }),
      card({ id: "duplicate", phrase: "keep it simple", reviewStep: 0 }),
      card({ id: "bad-date", phrase: "Another phrase", dueAt: "not-a-date" }),
    ],
  }, { now: NOW, timeZone: "Not/A_Real_Zone" });

  assert.equal(result.timeZone, "UTC");
  assert.equal(result.metrics.totalSessions, 1);
  assert.equal(result.metrics.timedSpeakingSeconds, Progress.MAX_SESSION_SECONDS);
  assert.equal(result.metrics.learnerTurns, Progress.MAX_TURNS);
  assert.equal(result.metrics.savedPhrases, 1);
  assert.equal(result.review.stages[5].count, 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /sk_should|private transcript|duplicate|apiKey|waveform/i,
  );
});

test("practice days use local calendar dates and deduplicate sessions in one date", () => {
  const history = {
    sessions: [
      session({ id: "evening-one", endedAt: Date.parse("2026-08-14T00:30:00.000Z") }),
      session({ id: "evening-two", endedAt: Date.parse("2026-08-14T06:30:00.000Z") }),
      session({ id: "next-local-day", endedAt: Date.parse("2026-08-14T08:30:00.000Z") }),
      session({ id: "too-old", endedAt: Date.parse("2026-08-07T06:30:00.000Z") }),
    ],
  };
  const result = Progress.summarize(history, {}, {
    now: NOW,
    timeZone: "America/Los_Angeles",
  });

  assert.equal(result.metrics.practiceDays7, 2);
  assert.deepEqual(
    result.activityDays.filter(day => day.sessionCount > 0).map(day => [day.date, day.sessionCount]),
    [["2026-08-13", 2], ["2026-08-14", 1]],
  );
});

test("memory works without history and reports due phrases by review step", () => {
  const result = Progress.summarize({}, {
    cards: [
      card(),
      card({
        id: "card-two",
        phrase: "The tradeoff was worth it.",
        dueAt: NOW + Progress.DAY_MS,
        reviewStep: 2,
        lastReviewedAt: NOW - Progress.DAY_MS,
      }),
      card({
        id: "card-three",
        phrase: "Here is the key decision.",
        dueAt: NOW - 1,
        reviewStep: 5,
        lastReviewedAt: NOW - Progress.DAY_MS,
      }),
    ],
  }, { now: NOW, timeZone: "UTC" });

  assert.equal(result.metrics.totalSessions, 0);
  assert.equal(result.metrics.savedPhrases, 3);
  assert.equal(result.metrics.duePhrases, 2);
  assert.equal(result.review.reviewedPhrases, 2);
  assert.equal(result.review.establishedPhrases, 1);
  assert.equal(result.review.stages[0].dueCount, 1);
  assert.equal(result.review.stages[2].count, 1);
  assert.equal(result.review.stages[5].dueCount, 1);
  assert.equal(result.feedback.headline, "Your phrase bank is ready for recall.");
  assert.match(result.feedback.review, /reached the 60-day review rhythm/);
  assert.match(result.feedback.nextAction, /2 phrases are ready/);
});

test("the review path exposes the fixed product rule instead of claiming a measured curve", () => {
  const result = Progress.summarize({}, { cards: [] }, { now: NOW, timeZone: "UTC" });

  assert.deepEqual(result.review.schedule.successfulRecallDays, [1, 3, 7, 21, 60]);
  assert.equal(result.review.schedule.notQuiteDelayMinutes, 10);
  assert.equal(result.review.schedule.isMeasuredMemoryCurve, false);
  assert.match(result.review.schedule.explanation, /transparent product rule/i);
  assert.match(result.review.schedule.explanation, /not a measured memory or forgetting curve/i);
  assert.match(result.review.schedule.explanation, /Not quite.*10 minutes/i);
  assert.deepEqual(
    result.review.stages.map(stage => stage.nextIntervalDays),
    [1, 3, 7, 21, 60, 60],
  );
});

test("future and older sessions do not inflate the last-seven-calendar-days metric", () => {
  const result = Progress.summarize({
    sessions: [
      session({ id: "today", endedAt: NOW }),
      session({ id: "six-days", endedAt: NOW - 6 * Progress.DAY_MS }),
      session({ id: "seven-days", endedAt: NOW - 7 * Progress.DAY_MS }),
      session({ id: "future", endedAt: NOW + Progress.DAY_MS }),
    ],
  }, {}, { now: NOW, timeZone: "UTC" });

  assert.equal(result.metrics.totalSessions, 4);
  assert.equal(result.metrics.practiceDays7, 2);
});

test("all generated copy is bounded and grounded in exported metrics", () => {
  const result = Progress.summarize({ sessions: [session()] }, {
    cards: [card()],
  }, { now: NOW, timeZone: "UTC" });

  Object.values(result.feedback).forEach(value => {
    assert.equal(typeof value, "string");
    assert.ok(value.length > 0);
    assert.ok(value.length <= Progress.MAX_TEXT_LENGTH);
  });
  assert.doesNotMatch(JSON.stringify(result.feedback), /improved|better than|ability|streak|percent|%/i);
});
