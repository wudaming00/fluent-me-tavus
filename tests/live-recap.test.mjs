import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const Recap = require("../server/static/live.js");

function metrics(overrides = {}) {
  return {
    durationSec: null,
    wpm: null,
    wordCount: 0,
    strongFillers: 0,
    repeatedWords: 0,
    ...overrides,
  };
}

test("builds recap evidence only from real learner turns and labels partial timing", () => {
  const evidence = Recap.recapEvidence([
    { role: "user", text: "First answer", metrics: metrics({ durationSec: 5, wpm: 120, wordCount: 10, strongFillers: 1 }) },
    { role: "coach", text: "Tell me more", metrics: metrics({ durationSec: 2, wpm: 90, strongFillers: 9 }) },
    { role: "user", text: "Second answer", metrics: metrics({ durationSec: 6, wpm: 150, wordCount: 15 }) },
    { role: "user", text: "Third answer without timing", metrics: metrics({ repeatedWords: 1 }) },
    { role: "user", typed: true, text: "Typed answer", metrics: metrics({ strongFillers: 1 }) },
  ], { total: 4, due: 2 });

  assert.deepEqual(evidence, {
    learnerTurns: 4,
    spokenTurns: 3,
    typedTurns: 1,
    timedTurns: 2,
    durationSec: 11,
    durationComplete: false,
    paceTurns: 2,
    medianWpm: 135,
    averageWpm: 135,
    filledPauses: 1,
    repeatedWords: 1,
    savedPhrases: 4,
    duePhrases: 2,
  });
  const line = Recap.recapEvidenceLine(evidence);
  assert.match(line, /11\.0s known across 2\/3 spoken turns/);
  assert.match(line, /median 135 WPM across 2 timed turns/);
  assert.match(line, /1 high-confidence filled pause/);
  assert.match(line, /4 saved · 2 due/);
});

test("withholds pace when fewer than two sufficiently supported turn metrics exist", () => {
  const evidence = Recap.recapEvidence([
    { role: "user", text: "A complete answer", metrics: metrics({ durationSec: 4, wpm: 122, wordCount: 8 }) },
    { role: "user", text: "Short", metrics: metrics() },
  ]);
  assert.equal(evidence.medianWpm, null);
  assert.equal(evidence.averageWpm, null);
  assert.match(Recap.recapEvidenceLine(evidence), /pace withheld \(needs 2 timed turns; 1 available\)/);
});

test("deterministic fallback describes pace without declaring it good or bad", () => {
  const data = Recap.deterministicRecap({
    learnerTurns: 2,
    paceTurns: 2,
    medianWpm: 190,
    filledPauses: 0,
    repeatedWords: 0,
  }, "A phrase I used", "I chose the simplest prototype first");
  assert.match(data.overview, /median pace was 190 WPM across 2 timed turns/);
  assert.doesNotMatch(`${data.overview} ${data.focus}`, /too fast|too slow|good pace|bad pace/i);
  assert.match(data.worked, /“I chose the simplest prototype first”/);
  assert.equal(data.phrase, "A phrase I used");
});

test("accepts only the strict four-field JSON recap and grounds its phrase", () => {
  const fallback = Recap.deterministicRecap({ learnerTurns: 2 }, "");
  const parsed = Recap.parseStructuredRecap(JSON.stringify({
    overview: "You explained why the first prototype mattered.",
    worked: "You made the decision concrete with “customer problem”.",
    focus: "Name the result immediately after the decision.",
    phrase: "customer problem",
  }), fallback, ["We began with the customer problem before building anything."]);
  assert.equal(parsed.structured, true);
  assert.equal(parsed.phrase, "customer problem");
});

test("rejects extra keys and an ungrounded phrase", () => {
  const fallback = Recap.deterministicRecap({ learnerTurns: 1 }, "safe phrase");
  const extra = Recap.parseStructuredRecap(JSON.stringify({
    overview: "Overview",
    worked: "Worked",
    focus: "Focus",
    phrase: "invented phrase",
    score: "99",
  }), fallback, ["The actual learner turn"]);
  assert.equal(extra.structured, false);
  assert.equal(extra.phrase, "safe phrase");

  const ungrounded = Recap.parseStructuredRecap(JSON.stringify({
    overview: "Overview",
    worked: "Worked",
    focus: "Focus",
    phrase: "invented phrase",
  }), fallback, ["The actual learner turn"]);
  assert.equal(ungrounded.structured, true);
  assert.equal(ungrounded.phrase, "safe phrase");
});

test("keeps deterministic fields when coach output invents voice or emotion claims", () => {
  const fallback = {
    overview: "Evidence overview",
    worked: "Evidence worked",
    focus: "Evidence focus",
    phrase: "real phrase",
  };
  const parsed = Recap.parseStructuredRecap(JSON.stringify({
    overview: "You sounded confident and calm.",
    worked: "Your pronunciation was native.",
    focus: "Use more pitch and intonation.",
    phrase: "real phrase",
  }), fallback, ["I used the real phrase here"]);
  assert.equal(parsed.overview, fallback.overview);
  assert.equal(parsed.worked, fallback.worked);
  assert.equal(parsed.focus, fallback.focus);
  assert.equal(parsed.phrase, "real phrase");
});

test("fails closed to deterministic evidence when the response is not structured", () => {
  const fallback = Recap.deterministicRecap({ learnerTurns: 1 }, "");
  const parsed = Recap.parseStructuredRecap("You explained the product and its customer clearly.", fallback, []);
  assert.equal(parsed.structured, false);
  assert.equal(parsed.overview, fallback.overview);
  assert.equal(parsed.worked, fallback.worked);
  assert.equal(parsed.focus, fallback.focus);

});

test("parses speakable labelled sections without asking the coach to read JSON", () => {
  const fallback = Recap.deterministicRecap({ learnerTurns: 2 }, "", "We started with one customer problem");
  const parsed = Recap.parseStructuredRecap([
    "WHAT WORKED: You anchored the story in “one customer problem”.",
    "ONE NEXT REP: Retell the result in 30 seconds.",
    "PHRASE TO KEEP: customer problem",
  ].join("\n"), fallback, ["We started with one customer problem before building."]);
  assert.equal(parsed.structured, true);
  assert.equal(parsed.overview, fallback.overview);
  assert.equal(parsed.phrase, "customer problem");
  assert.match(parsed.worked, /“one customer problem”/);
});

test("bounds every accepted coach field", () => {
  const fallback = Recap.deterministicRecap({ learnerTurns: 1 }, "");
  const parsed = Recap.parseStructuredRecap(JSON.stringify({
    overview: "o".repeat(300),
    worked: `“real learner phrase” ${"w".repeat(300)}`,
    focus: "f".repeat(300),
    phrase: "useful phrase",
  }), fallback, ["This is a useful phrase from my answer and a real learner phrase"]);
  assert.equal(parsed.overview.length, 260);
  assert.equal(parsed.worked.length, 220);
  assert.equal(parsed.focus.length, 220);
  assert.equal(parsed.phrase, "useful phrase");
});

test("explains chart evidence without treating gaps or scale as a score", () => {
  const unavailable = Recap.chartMeaning({ signalAnalysis: { available: false } });
  assert.match(unavailable, /cannot support claims about pronunciation or emotion/);

  const available = Recap.chartMeaning({
    signalAnalysis: {
      available: true,
      pauses: { pauseCount: 1 },
      pitch: { voicedFrames: 8, voicedFraction: 0.4 },
    },
  });
  assert.match(available, /1 internal pause was detected/);
  assert.match(available, /auto-scaled/);
  assert.match(available, /Pitch gaps can be unvoiced or low-confidence audio; they do not prove silence/);
  assert.match(available, /not a pronunciation, fluency, or emotion score/);
});

test("normalizes only the supported timed-session choices", () => {
  assert.equal(Recap.normalizeSessionMinutes(5), 5);
  assert.equal(Recap.normalizeSessionMinutes("10"), 10);
  assert.equal(Recap.normalizeSessionMinutes(15), 15);
  assert.equal(Recap.normalizeSessionMinutes("25"), 25);
  assert.equal(Recap.normalizeSessionMinutes(0), null);
  assert.equal(Recap.normalizeSessionMinutes("open"), null);
  assert.equal(Recap.normalizeSessionMinutes(7), null);
});

test("timed-session clock warns once the final minute begins and expires at zero", () => {
  const beforeWarning = Recap.sessionClockSnapshot(8 * 60 * 1000 + 59_000, 10);
  assert.deepEqual(beforeWarning, {
    elapsedSec: 539,
    remainingSec: 61,
    warningDue: false,
    expired: false,
  });

  const warning = Recap.sessionClockSnapshot(9 * 60 * 1000, 10);
  assert.equal(warning.remainingSec, 60);
  assert.equal(warning.warningDue, true);
  assert.equal(warning.expired, false);

  const fiveMinuteWarning = Recap.sessionClockSnapshot(4 * 60 * 1000, 5);
  assert.equal(fiveMinuteWarning.remainingSec, 60);
  assert.equal(fiveMinuteWarning.warningDue, true);

  const expired = Recap.sessionClockSnapshot(10 * 60 * 1000, 10);
  assert.equal(expired.remainingSec, 0);
  assert.equal(expired.warningDue, false);
  assert.equal(expired.expired, true);
  assert.equal(Recap.shouldAutoEndSession(expired, true, false), true);
  assert.equal(Recap.shouldAutoEndSession(expired, false, false), false);
  assert.equal(Recap.shouldAutoEndSession(expired, true, true), false);
});

test("open-ended sessions count elapsed time without warning or expiring", () => {
  const open = Recap.sessionClockSnapshot(90_500, "open");
  assert.deepEqual(open, {
    elapsedSec: 90,
    remainingSec: null,
    warningDue: false,
    expired: false,
  });
  assert.equal(Recap.shouldAutoEndSession(open, true, false), false);
  assert.equal(Recap.formatSessionClock(open.elapsedSec), "01:30");
});

test("history saves only when the learner opted in before this session and remains opted in", () => {
  const eligible = {
    sessionOptedIn: true,
    historyEnabled: true,
    sessionId: "session-1",
    finalizedSessionId: "",
    hasRecap: true,
    learnerTurns: 2,
  };

  assert.equal(Recap.shouldFinalizeSessionHistory(eligible), true);
  assert.equal(Recap.shouldFinalizeSessionHistory({ ...eligible, sessionOptedIn: false }), false);
  assert.equal(Recap.shouldFinalizeSessionHistory({ ...eligible, historyEnabled: false }), false);
  assert.equal(Recap.shouldFinalizeSessionHistory({ ...eligible, finalizedSessionId: "session-1" }), false);
  assert.equal(Recap.shouldFinalizeSessionHistory({ ...eligible, hasRecap: false }), false);
  assert.equal(Recap.shouldFinalizeSessionHistory({ ...eligible, learnerTurns: 0 }), false);
});

test("ending refreshes a missing or stale language review but reuses a current one", () => {
  assert.equal(Recap.shouldRefreshLanguageReviewAtEnd({ available: true, hasReview: false }), true);
  assert.equal(Recap.shouldRefreshLanguageReviewAtEnd({ available: true, hasReview: true, stale: true }), true);
  assert.equal(Recap.shouldRefreshLanguageReviewAtEnd({ available: true, hasReview: true, stale: false }), false);
  assert.equal(Recap.shouldRefreshLanguageReviewAtEnd({ available: false, hasReview: false }), false);
});

test("builds a compact finalized-history candidate without transcript or media data", () => {
  const snapshot = Recap.sessionHistoryCandidate({
    id: "session-test-1",
    endedAt: 1_800_000_000_000,
    durationSec: 601.4,
    evidence: {
      learnerTurns: 5,
      spokenTurns: 4,
      durationSec: 81.6,
      medianWpm: 123,
      filledPauses: 2,
      repeatedWords: 1,
    },
    recap: {
      overview: "You completed a focused conversation.",
      worked: "Your decision was concrete.",
      focus: "Connect the decision to the result.",
      phrase: "The tradeoff was worth it.",
    },
    source: "timer",
    transcript: "must not be retained",
    waveform: [0.2, 0.8],
  });

  assert.deepEqual(Object.keys(snapshot).sort(), [
    "durationSec", "endedAt", "evidenceLine", "filledPauses", "id", "learnerTurns",
    "medianWpm", "recap", "repeatedWords", "source", "spokenTurns", "timedSeconds",
  ]);
  assert.equal(snapshot.durationSec, 601);
  assert.equal(snapshot.timedSeconds, 82);
  assert.equal(snapshot.source, "timer");
  assert.doesNotMatch(JSON.stringify(snapshot), /transcript|waveform|must not be retained/);
});
