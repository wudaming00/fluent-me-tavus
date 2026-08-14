(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FluentMeProgressCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_SESSIONS = 20;
  const MAX_CARDS = 50;
  const MAX_SESSION_SECONDS = 24 * 60 * 60;
  const MAX_TURNS = 10_000;
  const MAX_TEXT_LENGTH = 240;
  const REVIEW_INTERVAL_DAYS = Object.freeze([1, 3, 7, 21, 60]);
  const NOT_QUITE_DELAY_MINUTES = 10;

  const REVIEW_STAGE_COPY = Object.freeze([
    Object.freeze({ label: "New / rebuilding", nextIntervalDays: 1 }),
    Object.freeze({ label: "1-day return", nextIntervalDays: 3 }),
    Object.freeze({ label: "3-day return", nextIntervalDays: 7 }),
    Object.freeze({ label: "7-day return", nextIntervalDays: 21 }),
    Object.freeze({ label: "21-day return", nextIntervalDays: 60 }),
    Object.freeze({ label: "60-day rhythm", nextIntervalDays: 60 }),
  ]);

  function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength)
      .trim();
  }

  function boundedWhole(value, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(maximum, Math.floor(number));
  }

  function timestamp(value, fallback = null) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 8.64e15) return fallback;
    return Math.floor(number);
  }

  function safeReviewStep(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(REVIEW_INTERVAL_DAYS.length, Math.floor(number)));
  }

  function normalizePhrase(value) {
    return cleanText(value)
      .toLocaleLowerCase("en")
      .replace(/[’]/g, "'")
      .replace(/[^\p{L}\p{N}']+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeTimeZone(value) {
    const requested = cleanText(value, 64);
    if (requested) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: requested }).format(0);
        return requested;
      } catch {
        // Fall through to a stable, non-throwing default.
      }
    }
    if (!requested) {
      try {
        const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (local) return local;
      } catch {
        // Fall through to UTC.
      }
    }
    return "UTC";
  }

  function datePartsAt(value, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(value))
        .filter(part => part.type !== "literal")
        .map(part => [part.type, part.value]),
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
    };
  }

  function dateInfoAt(value, timeZone) {
    const parts = datePartsAt(value, timeZone);
    const key = [
      String(parts.year).padStart(4, "0"),
      String(parts.month).padStart(2, "0"),
      String(parts.day).padStart(2, "0"),
    ].join("-");
    return {
      key,
      ordinal: Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS),
    };
  }

  function validId(value) {
    const id = cleanText(value, 96);
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id) ? id : "";
  }

  function sanitizeSessions(input) {
    const candidates = Array.isArray(input?.sessions) ? input.sessions : [];
    const sessions = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (sessions.length >= MAX_SESSIONS) break;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const endedAt = timestamp(candidate.endedAt);
      if (endedAt == null || endedAt <= 0) continue;
      const durationSec = boundedWhole(candidate.durationSec, MAX_SESSION_SECONDS);
      const learnerTurns = boundedWhole(candidate.learnerTurns, MAX_TURNS);
      const timedSpeakingSeconds = Math.min(
        durationSec,
        boundedWhole(candidate.timedSeconds, MAX_SESSION_SECONDS),
      );
      const id = validId(candidate.id);
      const key = id || [endedAt, durationSec, learnerTurns, timedSpeakingSeconds].join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      sessions.push({ endedAt, durationSec, learnerTurns, timedSpeakingSeconds });
    }
    return sessions;
  }

  function sanitizeCards(input) {
    const candidates = Array.isArray(input?.cards) ? input.cards : [];
    const cards = [];
    const phrases = new Set();
    for (const candidate of candidates) {
      if (cards.length >= MAX_CARDS) break;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const phraseKey = normalizePhrase(candidate.phrase);
      if (!phraseKey || phrases.has(phraseKey)) continue;
      const dueAt = timestamp(candidate.dueAt);
      if (dueAt == null) continue;
      phrases.add(phraseKey);
      cards.push({
        dueAt,
        reviewStep: safeReviewStep(candidate.reviewStep),
        lastReviewedAt: candidate.lastReviewedAt == null
          ? null
          : timestamp(candidate.lastReviewedAt),
      });
    }
    return cards;
  }

  function saturatingSum(values, maximum) {
    let sum = 0;
    for (const value of values) sum = Math.min(maximum, sum + value);
    return sum;
  }

  function recentActivity(sessions, now, timeZone) {
    const current = dateInfoAt(now, timeZone);
    const byOrdinal = new Map();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const ordinal = current.ordinal - offset;
      const date = new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
      byOrdinal.set(ordinal, {
        date,
        sessionCount: 0,
        timedSpeakingSeconds: 0,
        learnerTurns: 0,
      });
    }
    sessions.forEach(session => {
      const info = dateInfoAt(session.endedAt, timeZone);
      const day = byOrdinal.get(info.ordinal);
      if (!day) return;
      day.sessionCount += 1;
      day.timedSpeakingSeconds += session.timedSpeakingSeconds;
      day.learnerTurns += session.learnerTurns;
    });
    const days = Array.from(byOrdinal.values());
    return {
      days,
      practiceDays: days.filter(day => day.sessionCount > 0).length,
    };
  }

  function reviewStages(cards, now) {
    return REVIEW_STAGE_COPY.map((definition, step) => {
      const members = cards.filter(card => card.reviewStep === step);
      const count = members.length;
      const dueCount = members.filter(card => card.dueAt <= now).length;
      const days = definition.nextIntervalDays;
      return {
        reviewStep: step,
        label: definition.label,
        count,
        dueCount,
        nextIntervalDays: days,
        explanation: step === REVIEW_INTERVAL_DAYS.length
          ? "A successful recall keeps the next review on the 60-day rhythm."
          : `A successful recall schedules the next review in ${days} ${days === 1 ? "day" : "days"}.`,
      };
    });
  }

  function formatDuration(value) {
    const seconds = boundedWhole(value, MAX_SESSIONS * MAX_SESSION_SECONDS);
    if (seconds < 60) return `${seconds} sec`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (!hours) return `${minutes} min`;
    if (!minutes) return `${hours} hr`;
    return `${hours} hr ${minutes} min`;
  }

  function plural(value, singular, pluralForm = `${singular}s`) {
    return value === 1 ? singular : pluralForm;
  }

  function buildFeedback(metrics, review) {
    let headline;
    let detail;
    if (metrics.practiceDays7 > 0) {
      headline = metrics.practiceDays7 === 1
        ? "You made time to speak this week."
        : `You made time to speak on ${metrics.practiceDays7} days this week.`;
      detail = `${metrics.totalSessions} saved ${plural(metrics.totalSessions, "session recap")} ${metrics.totalSessions === 1 ? "captures" : "capture"} ${formatDuration(metrics.timedSpeakingSeconds)} of timed speaking across ${metrics.learnerTurns} learner ${plural(metrics.learnerTurns, "turn")}.`;
    } else if (metrics.totalSessions > 0) {
      headline = `You have ${metrics.totalSessions} saved ${plural(metrics.totalSessions, "session recap")}.`;
      detail = `Your latest saved history contains ${formatDuration(metrics.timedSpeakingSeconds)} of timed speaking across ${metrics.learnerTurns} learner ${plural(metrics.learnerTurns, "turn")}.`;
    } else if (metrics.savedPhrases > 0) {
      headline = "Your phrase bank is ready for recall.";
      detail = `${metrics.savedPhrases} ${plural(metrics.savedPhrases, "phrase")} saved, even before a completed session appears in history.`;
    } else {
      headline = "Your progress starts with one real turn.";
      detail = "Complete a session or explicitly save a useful phrase to begin a private progress record.";
    }

    let reviewText;
    if (review.establishedPhrases > 0) {
      reviewText = `${review.establishedPhrases} ${plural(review.establishedPhrases, "phrase")} reached the 60-day review rhythm.`;
    } else if (review.reviewedPhrases > 0) {
      reviewText = `${review.reviewedPhrases} saved ${plural(review.reviewedPhrases, "phrase has", "phrases have")} a recorded review.`;
    } else if (metrics.savedPhrases > 0) {
      reviewText = `${metrics.savedPhrases} ${plural(metrics.savedPhrases, "phrase is", "phrases are")} saved for future recall.`;
    } else {
      reviewText = "Save a phrase only when it feels useful enough to say again.";
    }

    let nextAction;
    if (metrics.duePhrases > 0) {
      nextAction = `${metrics.duePhrases} ${plural(metrics.duePhrases, "phrase is", "phrases are")} ready for a short recall now.`;
    } else if (metrics.savedPhrases > 0) {
      nextAction = "Nothing is due now; the next review is already scheduled.";
    } else if (metrics.totalSessions > 0) {
      nextAction = "Save one useful phrase from your next conversation to start spaced review.";
    } else {
      nextAction = "Start with one sentence; progress will reflect only what you actually practice.";
    }

    return {
      headline: cleanText(headline),
      detail: cleanText(detail),
      review: cleanText(reviewText),
      nextAction: cleanText(nextAction),
    };
  }

  function summarize(historyInput, memoryInput, options = {}) {
    const now = timestamp(options.now, Date.now());
    const timeZone = safeTimeZone(options.timeZone);
    const sessions = sanitizeSessions(historyInput);
    const cards = sanitizeCards(memoryInput);
    const activity = recentActivity(sessions, now, timeZone);
    const stages = reviewStages(cards, now);
    const duePhrases = cards.filter(card => card.dueAt <= now).length;
    const reviewedPhrases = cards.filter(card => card.lastReviewedAt != null).length;
    const establishedPhrases = cards.filter(
      card => card.reviewStep >= REVIEW_INTERVAL_DAYS.length,
    ).length;
    const futureDue = cards
      .map(card => card.dueAt)
      .filter(dueAt => dueAt > now)
      .sort((left, right) => left - right);
    const metrics = {
      totalSessions: sessions.length,
      timedSpeakingSeconds: saturatingSum(
        sessions.map(session => session.timedSpeakingSeconds),
        MAX_SESSIONS * MAX_SESSION_SECONDS,
      ),
      learnerTurns: saturatingSum(
        sessions.map(session => session.learnerTurns),
        MAX_SESSIONS * MAX_TURNS,
      ),
      practiceDays7: activity.practiceDays,
      savedPhrases: cards.length,
      duePhrases,
    };
    const review = {
      reviewedPhrases,
      establishedPhrases,
      nextDueAt: futureDue.length ? futureDue[0] : null,
      stages,
      schedule: {
        kind: "fixed_product_rule",
        successfulRecallDays: REVIEW_INTERVAL_DAYS.slice(),
        notQuiteDelayMinutes: NOT_QUITE_DELAY_MINUTES,
        isMeasuredMemoryCurve: false,
        explanation: "This is a transparent product rule, not a measured memory or forgetting curve. Successful recall schedules 1, 3, 7, 21, then 60 days; Not quite schedules another try in about 10 minutes.",
      },
    };
    return {
      version: VERSION,
      asOf: now,
      timeZone,
      metrics,
      activityDays: activity.days,
      review,
      feedback: buildFeedback(metrics, review),
    };
  }

  return {
    VERSION,
    DAY_MS,
    MAX_SESSIONS,
    MAX_CARDS,
    MAX_SESSION_SECONDS,
    MAX_TURNS,
    MAX_TEXT_LENGTH,
    REVIEW_INTERVAL_DAYS,
    NOT_QUITE_DELAY_MINUTES,
    cleanText,
    safeTimeZone,
    dateInfoAt,
    sanitizeSessions,
    sanitizeCards,
    formatDuration,
    buildFeedback,
    summarize,
  };
});
