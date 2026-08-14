(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FluentMeSessionHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "fluent-me-session-history-v1";
  const MAX_SESSIONS = 20;
  const MAX_SESSION_SECONDS = 24 * 60 * 60;
  const MAX_TURNS = 10_000;
  const TEXT_LIMITS = Object.freeze({
    overview: 360,
    worked: 480,
    focus: 360,
    phrase: 240,
    evidenceLine: 360,
  });
  const SOURCES = new Set(["coach", "evidence", "end_session", "timer", "manual"]);

  function emptyState() {
    return { version: VERSION, sessions: [] };
  }

  function redactSecrets(value) {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "[redacted]")
      .replace(/\b(?:sk|api)[_-][A-Za-z0-9_-]{16,}\b/gi, "[redacted]")
      .replace(/\b[a-f0-9]{32,64}\b/gi, "[redacted]");
  }

  function cleanText(value, maxLength) {
    return redactSecrets(String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim())
      .slice(0, maxLength)
      .trim();
  }

  function safeTimestamp(value, fallback = null) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 8.64e15) return fallback;
    return Math.floor(number);
  }

  function safeWholeNumber(value, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(maximum, Math.floor(number));
  }

  function safeOptionalWholeNumber(value, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.min(maximum, Math.floor(number));
  }

  function safeSource(value) {
    const normalized = cleanText(value, 32).toLocaleLowerCase("en").replace(/[ -]+/g, "_");
    return SOURCES.has(normalized) ? normalized : "evidence";
  }

  function hashKey(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  function generatedId(endedAt, recap) {
    const seed = [recap.overview, recap.worked, recap.focus, recap.phrase].join("|");
    return `session-${endedAt.toString(36)}-${hashKey(seed)}`;
  }

  function safeId(value, endedAt, recap) {
    const cleaned = cleanText(value, 96);
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(cleaned)
      ? cleaned
      : generatedId(endedAt, recap);
  }

  function sanitizeRecap(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const recap = {
      overview: cleanText(input.overview, TEXT_LIMITS.overview),
      worked: cleanText(input.worked, TEXT_LIMITS.worked),
      focus: cleanText(input.focus, TEXT_LIMITS.focus),
      phrase: cleanText(input.phrase, TEXT_LIMITS.phrase),
    };
    // A finalized recap must contain the three explanatory sections. The
    // reusable phrase is intentionally optional when no grounded phrase exists.
    if (!recap.overview || !recap.worked || !recap.focus) return null;
    return recap;
  }

  function sanitizeSession(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const endedAt = safeTimestamp(input.endedAt);
    const recap = sanitizeRecap(input.recap);
    if (!endedAt || !recap) return null;

    const durationSec = safeWholeNumber(input.durationSec, MAX_SESSION_SECONDS);
    const learnerTurns = safeWholeNumber(input.learnerTurns, MAX_TURNS);
    const spokenTurns = Math.min(
      learnerTurns,
      safeWholeNumber(input.spokenTurns, MAX_TURNS),
    );
    const timedSeconds = Math.min(
      durationSec,
      safeWholeNumber(input.timedSeconds, MAX_SESSION_SECONDS),
    );
    const medianWpm = safeOptionalWholeNumber(input.medianWpm, 400);
    const filledPauses = safeWholeNumber(input.filledPauses, MAX_TURNS * 100);
    const repeatedWords = safeWholeNumber(input.repeatedWords, MAX_TURNS * 100);

    return {
      id: safeId(input.id, endedAt, recap),
      endedAt,
      durationSec,
      learnerTurns,
      spokenTurns,
      timedSeconds,
      medianWpm,
      filledPauses,
      repeatedWords,
      recap,
      evidenceLine: cleanText(input.evidenceLine, TEXT_LIMITS.evidenceLine),
      source: safeSource(input.source),
    };
  }

  function sessionOrder(left, right) {
    return right.endedAt - left.endedAt || left.id.localeCompare(right.id);
  }

  function sanitizeState(input) {
    const candidates = Array.isArray(input?.sessions) ? input.sessions : [];
    const sessions = [];
    const ids = new Set();
    candidates
      .map(sanitizeSession)
      .filter(Boolean)
      .sort(sessionOrder)
      .forEach(session => {
        if (sessions.length >= MAX_SESSIONS || ids.has(session.id)) return;
        sessions.push(session);
        ids.add(session.id);
      });
    return { version: VERSION, sessions };
  }

  function parse(serialized) {
    if (serialized && typeof serialized === "object") return sanitizeState(serialized);
    if (typeof serialized !== "string" || !serialized.trim()) return emptyState();
    try {
      return sanitizeState(JSON.parse(serialized));
    } catch {
      return emptyState();
    }
  }

  function serialize(state) {
    return JSON.stringify(sanitizeState(state));
  }

  function appendFinalized(stateInput, candidate, options = {}) {
    const state = sanitizeState(stateInput);
    if (options.finalized !== true) {
      return { state, session: null, changed: false, reason: "finalization_required" };
    }

    const endedAt = safeTimestamp(candidate?.endedAt, safeTimestamp(options.now, Date.now()));
    const session = sanitizeSession({ ...candidate, endedAt });
    if (!session) return { state, session: null, changed: false, reason: "invalid_recap" };

    const previous = state.sessions.find(item => item.id === session.id) || null;
    const nextState = sanitizeState({
      sessions: [session, ...state.sessions.filter(item => item.id !== session.id)],
    });
    const retained = nextState.sessions.find(item => item.id === session.id) || null;
    if (!retained) {
      return { state, session: null, changed: false, reason: "outside_history_window" };
    }
    if (previous && JSON.stringify(previous) === JSON.stringify(retained)) {
      return { state, session: retained, changed: false, reason: "already_saved" };
    }
    return {
      state: nextState,
      session: retained,
      changed: true,
      reason: previous ? "updated" : "saved",
    };
  }

  function deleteSession(stateInput, id) {
    const state = sanitizeState(stateInput);
    const safe = cleanText(id, 96);
    const sessions = state.sessions.filter(session => session.id !== safe);
    return {
      state: { version: VERSION, sessions },
      removed: sessions.length !== state.sessions.length,
    };
  }

  function clearAll(stateInput) {
    const state = sanitizeState(stateInput);
    return { state: emptyState(), removed: state.sessions.length };
  }

  function load(storage) {
    if (!storage || typeof storage.getItem !== "function") return emptyState();
    try {
      return parse(storage.getItem(STORAGE_KEY));
    } catch {
      return emptyState();
    }
  }

  function clearStorage(storage) {
    if (!storage || typeof storage.removeItem !== "function") return false;
    try {
      storage.removeItem(STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function persist(storage, state) {
    if (!storage || typeof storage.setItem !== "function") {
      return { saved: false, cleared: false };
    }
    try {
      storage.setItem(STORAGE_KEY, serialize(state));
      return { saved: true, cleared: false };
    } catch {
      // Do not leave an older recap history behind after a failed replacement.
      return { saved: false, cleared: clearStorage(storage) };
    }
  }

  return {
    VERSION,
    STORAGE_KEY,
    MAX_SESSIONS,
    MAX_SESSION_SECONDS,
    MAX_TURNS,
    TEXT_LIMITS,
    emptyState,
    cleanText,
    sanitizeSession,
    sanitizeState,
    parse,
    serialize,
    appendFinalized,
    deleteSession,
    clearAll,
    load,
    persist,
    clearStorage,
  };
});
