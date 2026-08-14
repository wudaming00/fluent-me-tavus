import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const History = require("../server/static/session-history.js");

const NOW = 1_800_000_000_000;

function candidate(overrides = {}) {
  return {
    endedAt: NOW,
    durationSec: 600,
    learnerTurns: 8,
    spokenTurns: 7,
    timedSeconds: 182,
    medianWpm: 118,
    filledPauses: 3,
    repeatedWords: 1,
    recap: {
      overview: "You kept the conversation moving with concrete examples.",
      worked: "Your project decision was easy to follow.",
      focus: "Connect the decision directly to its result.",
      phrase: "The tradeoff was worth it.",
    },
    evidenceLine: "182s timed across 7 spoken turns.",
    source: "coach",
    ...overrides,
  };
}

function save(state, input = candidate(), options = {}) {
  return History.appendFinalized(state, input, { finalized: true, now: NOW, ...options });
}

test("invalid and malformed storage produce an empty versioned history", () => {
  assert.deepEqual(History.parse("not-json"), { version: 1, sessions: [] });
  assert.deepEqual(History.parse(""), { version: 1, sessions: [] });
  assert.deepEqual(History.parse(JSON.stringify({ sessions: [null, "bad", {}] })), {
    version: 1,
    sessions: [],
  });
});

test("a session cannot enter history without an explicit finalized signal", () => {
  const result = History.appendFinalized(History.emptyState(), candidate(), { now: NOW });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "finalization_required");
  assert.equal(result.state.sessions.length, 0);

  const missingRecap = save(History.emptyState(), candidate({ recap: null }));
  assert.equal(missingRecap.changed, false);
  assert.equal(missingRecap.reason, "invalid_recap");
});

test("serialization retains only bounded recap and aggregate evidence fields", () => {
  const result = save(History.emptyState(), candidate({
    transcript: "private raw transcript",
    rawAudio: "private audio",
    video: "private video",
    waveform: [0.1, 0.9],
    pitch: [120, 125],
    raven: { emotion: "happy" },
    providerSecret: "must never persist",
    recap: {
      ...candidate().recap,
      transcript: "nested transcript",
      apiKey: "sk_123456789012345678901234",
    },
  }));
  const encoded = History.serialize(result.state);
  const session = JSON.parse(encoded).sessions[0];

  assert.deepEqual(Object.keys(session).sort(), [
    "durationSec", "endedAt", "evidenceLine", "filledPauses", "id", "learnerTurns",
    "medianWpm", "recap", "repeatedWords", "source", "spokenTurns", "timedSeconds",
  ]);
  assert.deepEqual(Object.keys(session.recap).sort(), ["focus", "overview", "phrase", "worked"]);
  assert.doesNotMatch(
    encoded,
    /private raw|private audio|private video|waveform|pitch|raven|providerSecret|nested transcript|sk_123/i,
  );
});

test("untrusted text and counts are normalized, bounded, and internally consistent", () => {
  const result = save(History.emptyState(), candidate({
    id: "../../unsafe id",
    durationSec: 75,
    learnerTurns: 2,
    spokenTurns: 99,
    timedSeconds: 900,
    medianWpm: 999,
    filledPauses: -4,
    repeatedWords: 7,
    evidenceLine: `  ${"e".repeat(500)}  `,
    source: "remote-provider",
    recap: {
      overview: `  ${"o".repeat(500)}  `,
      worked: "Used\u0000 a clear example.",
      focus: "Never reveal sk_123456789012345678901234567890 or 7bc1f2e3c8d6408bb59a18673128653f.",
      phrase: "  Put   it into practice.  ",
    },
  }));
  const session = result.session;

  assert.match(session.id, /^session-/);
  assert.doesNotMatch(JSON.stringify(session), /sk_123|7bc1f2e3/i);
  assert.equal(session.durationSec, 75);
  assert.equal(session.learnerTurns, 2);
  assert.equal(session.spokenTurns, 2);
  assert.equal(session.timedSeconds, 75);
  assert.equal(session.medianWpm, 400);
  assert.equal(session.filledPauses, 0);
  assert.equal(session.repeatedWords, 7);
  assert.equal(session.recap.overview.length, History.TEXT_LIMITS.overview);
  assert.equal(session.recap.worked, "Used a clear example.");
  assert.equal(session.recap.focus, "Never reveal [redacted] or [redacted].");
  assert.equal(session.recap.phrase, "Put it into practice.");
  assert.equal(session.evidenceLine.length, History.TEXT_LIMITS.evidenceLine);
  assert.equal(session.source, "evidence");
});

test("history is newest first and retains at most twenty finalized sessions", () => {
  let state = History.emptyState();
  for (let index = 0; index < 25; index += 1) {
    const result = save(state, candidate({
      endedAt: NOW + index,
      recap: { ...candidate().recap, overview: `Session ${index}` },
    }));
    state = result.state;
  }

  assert.equal(state.sessions.length, History.MAX_SESSIONS);
  assert.equal(state.sessions[0].recap.overview, "Session 24");
  assert.equal(state.sessions.at(-1).recap.overview, "Session 5");
  assert.deepEqual(
    state.sessions.map(session => session.endedAt),
    state.sessions.map(session => session.endedAt).slice().sort((a, b) => b - a),
  );
});

test("saving the same snapshot is idempotent and a matching id can be updated", () => {
  const first = save(History.emptyState());
  const duplicate = save(first.state, { ...candidate(), id: first.session.id });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.reason, "already_saved");
  assert.equal(duplicate.state.sessions.length, 1);

  const updated = save(first.state, {
    ...candidate(),
    id: first.session.id,
    recap: { ...candidate().recap, focus: "Pause after the key result." },
  });
  assert.equal(updated.changed, true);
  assert.equal(updated.reason, "updated");
  assert.equal(updated.state.sessions.length, 1);
  assert.equal(updated.session.recap.focus, "Pause after the key result.");
});

test("parsing hostile stored state drops invalid records, duplicate ids, and extra fields", () => {
  const good = save(History.emptyState()).session;
  const parsed = History.parse(JSON.stringify({
    version: 999,
    apiKey: "secret",
    sessions: [
      { ...good, transcript: "do not keep" },
      { ...good, recap: { ...good.recap, overview: "duplicate id" } },
      { ...good, id: "broken", endedAt: -1 },
      { ...good, id: "incomplete", recap: { overview: "Only one section" } },
    ],
  }));

  assert.equal(parsed.version, 1);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].id, good.id);
  assert.doesNotMatch(History.serialize(parsed), /apiKey|secret|transcript|do not keep/);
});

test("one session can be deleted and all history can be cleared", () => {
  const first = save(History.emptyState());
  const second = save(first.state, candidate({
    endedAt: NOW + 1,
    recap: { ...candidate().recap, overview: "Second session" },
  }));
  const deleted = History.deleteSession(second.state, first.session.id);
  assert.equal(deleted.removed, true);
  assert.deepEqual(deleted.state.sessions.map(item => item.id), [second.session.id]);
  assert.equal(History.deleteSession(deleted.state, "missing").removed, false);

  const cleared = History.clearAll(deleted.state);
  assert.equal(cleared.removed, 1);
  assert.deepEqual(cleared.state, History.emptyState());
});

test("storage helpers round-trip safely and clear a stale snapshot after write failure", () => {
  const saved = save(History.emptyState());
  let stored = null;
  const storage = {
    getItem: key => key === History.STORAGE_KEY ? stored : null,
    setItem: (key, value) => { if (key === History.STORAGE_KEY) stored = value; },
    removeItem: key => { if (key === History.STORAGE_KEY) stored = null; },
  };

  assert.deepEqual(History.persist(storage, saved.state), { saved: true, cleared: false });
  assert.deepEqual(History.load(storage), saved.state);
  assert.equal(History.clearStorage(storage), true);
  assert.deepEqual(History.load(storage), History.emptyState());

  stored = History.serialize(saved.state);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.deepEqual(History.persist(storage, saved.state), { saved: false, cleared: true });
  assert.equal(stored, null);
});
