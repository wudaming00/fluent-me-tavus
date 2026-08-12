(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const STORAGE_KEY = "fluent-me:recent-practice:v2";
  const state = {
    capability: "browser",
    configured: false,
    mirrorVoiceReady: false,
    focus: "interview",
    goal: "",
    sessionState: "idle",
    speakerState: "none",
    feedbackState: "idle",
    attempts: [],
    transcriptFinal: "",
    transcriptInterim: "",
    recognition: null,
    mediaStream: null,
    audioContext: null,
    analyser: null,
    drawFrame: null,
    timerId: null,
    startedAt: 0,
    sessionStartedAt: 0,
    call: null,
    conversationId: null,
    joinTimeout: null,
    seenEvents: new Set(),
    pendingFeedback: null,
    latestFeedback: null,
    currentAudio: null,
    captionsVisible: true,
    ending: false,
  };

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function setScreen(screen) {
    document.body.dataset.screen = screen;
    $("setup-screen").hidden = screen !== "setup";
    $("practice-screen").hidden = screen !== "practice";
    $("review-screen").hidden = screen !== "review";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setSessionState(next, label) {
    state.sessionState = next;
    document.body.dataset.sessionState = next;
    if (label) setText("room-status", label);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const total = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.reason = payload.reason;
      throw error;
    }
    return payload;
  }

  function startTimer(kind = "recording") {
    clearInterval(state.timerId);
    state.startedAt = Date.now();
    if (!state.sessionStartedAt) state.sessionStartedAt = state.startedAt;
    const tick = () => {
      const elapsed = (Date.now() - (kind === "session" ? state.sessionStartedAt : state.startedAt)) / 1000;
      setText("room-timer", formatTime(elapsed));
      if (kind === "recording" && elapsed >= 60 && state.sessionState === "recording") finishBrowserAnswer();
    };
    tick();
    state.timerId = setInterval(tick, 250);
  }

  function stopTimer() {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  function currentGoal() {
    return $("practice-goal").value.trim().replace(/\s+/g, " ").slice(0, 240) || "Have a natural conversation in English";
  }

  function selectPrompt(button) {
    document.querySelectorAll(".prompt-chip").forEach(chip => chip.classList.toggle("selected", chip === button));
    state.focus = button.dataset.focus || "conversation";
    $("practice-goal").value = button.dataset.prompt || "";
  }

  function updateCapabilityUI() {
    const live = state.configured;
    state.capability = live ? "tavus" : "browser";
    $("capability-pill").classList.add("ready");
    setText("capability-label", live ? "Live video ready" : "Speaking practice ready");
    setText("mode-kicker", live ? "Live video conversation" : "60-second practice");
    setText("mode-title", live ? "Private coach ready" : "Ready on this device");
    setText("start-label", live ? "Start live conversation" : "Start speaking practice");
    setText("privacy-note", live
      ? "● Microphone required · camera optional · private room"
      : "● Microphone access starts only after you continue.");
    $("camera-setting").hidden = !live;
    $("start-button").disabled = false;
  }

  function readRecent() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  }

  function renderRecent() {
    const recent = readRecent();
    if (!recent?.goal || !Array.isArray(recent.attempts) || !recent.attempts.length) return;
    $("recent-practice").hidden = false;
    setText("recent-goal", recent.goal);
    const latest = recent.attempts.at(-1);
    const evidence = [latest.words ? `${latest.words} words` : null,
      Number.isFinite(latest.wpm) ? `${latest.wpm} wpm` : null,
      Number.isFinite(latest.fillers) ? `${latest.fillers} fillers` : null].filter(Boolean).join(" · ");
    setText("recent-result", evidence || "Saved on this device");
    $("recent-retry").onclick = () => {
      $("practice-goal").value = recent.goal;
      state.focus = recent.focus || "interview";
      startPractice();
    };
  }

  async function boot() {
    renderRecent();
    try {
      const status = await fetchJSON("/api/tavus/status", { headers: {} });
      state.configured = Boolean(status.configured);
      state.mirrorVoiceReady = Boolean(status.mirror_voice_ready);
    } catch {
      state.configured = false;
    }
    updateCapabilityUI();
    drawIdleWave();
  }

  function resetRoom(goal) {
    state.goal = goal;
    state.attempts = [];
    state.transcriptFinal = "";
    state.transcriptInterim = "";
    state.pendingFeedback = null;
    state.latestFeedback = null;
    state.feedbackState = "idle";
    state.seenEvents.clear();
    state.sessionStartedAt = 0;
    setText("room-goal", goal);
    setText("panel-goal", goal);
    setText("stage-prompt", goal);
    setText("room-timer", "00:00");
    setText("metric-time", "—");
    setText("metric-wpm", "—");
    setText("metric-fillers", "—");
    $("note-empty").hidden = false;
    $("note-result").hidden = true;
    $("attempt-compare").hidden = true;
    $("stage-message").hidden = true;
    $("text-fallback").hidden = true;
    $("caption-strip").hidden = true;
    setText("live-words", "Your words will appear here as you speak.");
    $("live-words").classList.remove("active");
  }

  function startPractice() {
    const goal = currentGoal();
    resetRoom(goal);
    setScreen("practice");
    if (state.capability === "tavus") startTavusPractice();
    else startBrowserPractice();
  }

  function startBrowserPractice() {
    $("browser-stage").hidden = false;
    $("video-stage").hidden = true;
    $("record-control").hidden = false;
    $("mic-toggle").hidden = true;
    $("camera-toggle").hidden = true;
    $("perception-tab").disabled = true;
    $("evidence").hidden = false;
    setText("stage-mode", Recognition ? "Microphone practice" : "Text fallback");
    prepareBrowserAttempt();
  }

  function prepareBrowserAttempt() {
    const attempt = state.attempts.length + 1;
    setSessionState("ready", "Ready to speak");
    setText("attempt-label", `Attempt ${attempt} of 2`);
    setText("stage-kicker", attempt === 1 ? "Your prompt" : "Try the same answer again");
    setText("stage-instruction", attempt === 1
      ? "Take a breath. Start when you are ready."
      : "Keep the useful parts. Make just the one change in your coaching note.");
    setText("record-label", "Start answer");
    $("record-control").disabled = false;
    $("text-fallback").hidden = true;
    $("stage-message").hidden = true;
    setText("live-words", "Your words will appear here as you speak.");
    $("live-words").classList.remove("active");
    drawIdleWave();
  }

  function cleanTranscript(value) {
    return String(value || "").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  }

  async function ensureMicrophone() {
    const active = state.mediaStream?.getAudioTracks().some(track => track.readyState === "live");
    if (active) return state.mediaStream;
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    return state.mediaStream;
  }

  function setupRecognition() {
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const words = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) state.transcriptFinal += `${words} `;
        else interim += words;
      }
      state.transcriptInterim = interim;
      const visible = cleanTranscript(`${state.transcriptFinal} ${interim}`);
      setText("live-words", visible || "Listening…");
      $("live-words").classList.toggle("active", Boolean(visible));
    };
    recognition.onerror = event => {
      if (["not-allowed", "service-not-allowed"].includes(event.error)) switchToTextFallback("Microphone transcription was blocked. You can still type the answer you would give.");
    };
    recognition.onend = () => {
      if (state.sessionState === "recording" && !state.ending) {
        try { recognition.start(); } catch {}
      }
    };
    return recognition;
  }

  async function beginBrowserAnswer() {
    setSessionState("permission", "Opening microphone");
    setText("record-label", "Allow microphone");
    state.transcriptFinal = "";
    state.transcriptInterim = "";
    try {
      await ensureMicrophone();
    } catch {
      switchToTextFallback("Microphone access is unavailable. Type the answer you would say aloud.");
      return;
    }
    if (!Recognition) {
      switchToTextFallback("This browser cannot create a live transcript. Type the answer you would say aloud.");
      return;
    }
    state.recognition = setupRecognition();
    setSessionState("recording", "Listening");
    setText("record-label", "Finish answer");
    setText("stage-instruction", "Speak naturally. Finish when your answer feels complete.");
    setText("live-words", "Listening…");
    startTimer("recording");
    startLiveWave();
    try { state.recognition.start(); } catch { switchToTextFallback("Speech transcription did not start. Type the answer you would say aloud."); }
  }

  function switchToTextFallback(message) {
    stopRecognitionAndMedia();
    setSessionState("text", "Text fallback");
    setText("stage-instruction", message);
    $("text-fallback").hidden = false;
    $("fallback-answer").value = cleanTranscript(`${state.transcriptFinal} ${state.transcriptInterim}`);
    $("fallback-answer").focus();
    setText("record-label", "Analyze answer");
    drawIdleWave();
  }

  function stopRecognitionAndMedia() {
    if (state.recognition) {
      state.recognition.onend = null;
      try { state.recognition.stop(); } catch {}
      state.recognition = null;
    }
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach(track => track.stop());
      state.mediaStream = null;
    }
    if (state.audioContext) {
      state.audioContext.close().catch(() => {});
      state.audioContext = null;
      state.analyser = null;
    }
    cancelAnimationFrame(state.drawFrame);
    state.drawFrame = null;
  }

  function finishBrowserAnswer() {
    if (state.sessionState !== "recording") return;
    const duration = Math.max(1, (Date.now() - state.startedAt) / 1000);
    const transcript = cleanTranscript(`${state.transcriptFinal} ${state.transcriptInterim}`);
    state.ending = true;
    stopTimer();
    stopRecognitionAndMedia();
    state.ending = false;
    if (transcript.split(/\s+/).filter(Boolean).length < 3) {
      switchToTextFallback("We did not catch enough words to analyze. Add the answer below, then continue.");
      return;
    }
    completeBrowserAttempt(transcript, duration, "speech");
  }

  function analyzeTypedAnswer() {
    const transcript = cleanTranscript($("fallback-answer").value);
    if (transcript.split(/\s+/).filter(Boolean).length < 3) {
      $("stage-message").hidden = false;
      setText("stage-message", "Add at least one complete sentence so the coaching note has something real to use.");
      return;
    }
    $("stage-message").hidden = true;
    completeBrowserAttempt(transcript, null, "typed");
  }

  function countMatches(text, pattern) {
    return (text.match(pattern) || []).length;
  }

  function analyzeEvidence(transcript, duration, source) {
    const words = transcript.match(/[A-Za-z0-9%'-]+/g) || [];
    const lower = transcript.toLowerCase();
    const fillers = countMatches(lower, /\b(?:um+|uh+|you know|basically|actually|kind of|sort of|i mean)\b/g);
    const wpm = Number.isFinite(duration) && duration > 4 ? Math.round(words.length / duration * 60) : null;
    const ownership = /\bi\s+(?:built|created|designed|led|decided|launched|implemented|started|owned|tested|changed|shipped)\b/i.test(transcript);
    const outcome = /\b(?:result|impact|outcome|increased|reduced|improved|grew|saved|adoption|users?|revenue|latency|accuracy|conversion)\b|\d+(?:\.\d+)?\s*%/i.test(transcript);
    const reasoning = /\b(?:because|so that|which meant|therefore|in order to|the reason)\b/i.test(transcript);
    const stackSignals = ["model", "data", "infrastructure", "application", "product", "distribution", "workflow", "agent", "interface"].filter(term => lower.includes(term)).length;
    const tavusSignals = ["perception", "turn", "memory", "face", "video", "voice", "latency", "interaction", "raven", "sparrow"].filter(term => lower.includes(term)).length;
    return { transcript, source, words: words.length, duration, wpm, fillers, ownership, outcome, reasoning, stackSignals, tavusSignals,
      structure: Number(ownership) + Number(outcome) + Number(reasoning) };
  }

  function coachingFor(evidence) {
    const goal = state.goal.toLowerCase();
    if (evidence.words < 28) return {
      title: "Add one concrete decision",
      body: "The answer is still an outline. Name the problem, one decision you personally made, and what happened next.",
      target: "Try again: problem → your decision → result.",
    };
    if (evidence.fillers >= 4 || evidence.fillers / Math.max(1, evidence.words) > .045) return {
      title: "Trade fillers for one pause",
      body: `We heard ${evidence.fillers} filler${evidence.fillers === 1 ? "" : "s"}. A short silent pause will make the same ideas sound more deliberate.`,
      target: "Try again: pause before the key decision instead of filling the space.",
    };
    if (Number.isFinite(evidence.wpm) && evidence.wpm > 175) return {
      title: "Give the important sentence room",
      body: `Your pace was ${evidence.wpm} words per minute. Slow down at the decision and the outcome so they do not disappear inside the story.`,
      target: "Try again: one beat before the decision, one beat before the result.",
    };
    if (goal.includes("ai ecosystem") && evidence.stackSignals < 3) return {
      title: "Show how the layers connect",
      body: "Make the ecosystem visible: foundation models and data become infrastructure, products, workflows, and distribution.",
      target: "Try again: model layer → infrastructure → application → distribution.",
    };
    if (goal.includes("tavus") && evidence.tavusSignals < 3) return {
      title: "Go beyond the face",
      body: "Separate the visual output from the system underneath: perception, conversational turn-taking, reasoning, voice, and memory.",
      target: "Try again: the face is the interface; the product is the real-time interaction system.",
    };
    if (!evidence.ownership) return {
      title: "Make your ownership unmistakable",
      body: "The story has context, but your decision is hard to locate. Use a direct sentence beginning with “I decided,” “I built,” or “I changed.”",
      target: "Try again: put your most important “I” sentence near the beginning.",
    };
    if (!evidence.outcome) return {
      title: "Land the result",
      body: "You explained the work. Finish with what changed—adoption, time saved, quality, learning, or the next decision it unlocked.",
      target: "Try again: end with one concrete outcome.",
    };
    if (!evidence.reasoning) return {
      title: "Expose the reasoning",
      body: "The actions are clear. Add one sentence explaining why that choice was better than the alternatives.",
      target: "Try again: add “I chose this because…” before the outcome.",
    };
    return {
      title: "Lead with the outcome",
      body: "The answer already has ownership, reasoning, and a result. Make it sharper by putting the result first, then explain how you got there.",
      target: "Try again: outcome first → decision → evidence.",
    };
  }

  function completeBrowserAttempt(transcript, duration, source) {
    const evidence = analyzeEvidence(transcript, duration, source);
    const coaching = coachingFor(evidence);
    const attempt = { ...evidence, coaching };
    state.attempts.push(attempt);
    state.feedbackState = "ready";
    setSessionState("feedback", "Coaching ready");
    renderAttempt(attempt);
    if (state.attempts.length > 1) renderComparison(state.attempts[0], attempt);
    setText("record-label", state.attempts.length < 2 ? "Try it again" : "Finish practice");
    setText("stage-kicker", "Answer captured");
    setText("stage-instruction", state.attempts.length < 2
      ? "Keep the answer. Change only the one thing in your coaching note."
      : "Two real attempts are ready to compare.");
    setText("live-words", transcript);
    $("live-words").classList.add("active");
    $("text-fallback").hidden = true;
    drawIdleWave();
  }

  function renderAttempt(attempt) {
    $("note-empty").hidden = true;
    $("note-result").hidden = false;
    setText("note-title", attempt.coaching.title);
    setText("note-body", attempt.coaching.body);
    setText("note-target", attempt.coaching.target);
    setText("metric-time", Number.isFinite(attempt.duration) ? formatTime(attempt.duration) : "typed");
    setText("metric-wpm", Number.isFinite(attempt.wpm) ? `${attempt.wpm}` : "—");
    setText("metric-fillers", attempt.fillers);
    $("listen-button").hidden = true;
  }

  function renderComparison(first, second) {
    const gains = [];
    if (second.structure > first.structure) gains.push("clearer structure");
    if (second.fillers < first.fillers) gains.push("fewer fillers");
    if (Number.isFinite(first.wpm) && Number.isFinite(second.wpm) && Math.abs(second.wpm - 140) < Math.abs(first.wpm - 140)) gains.push("steadier pace");
    $("attempt-compare").hidden = false;
    setText("compare-title", gains.length ? `Improved: ${gains.join(" · ")}` : "A more deliberate second pass");
    setText("compare-copy", gains.length
      ? "The comparison uses your two actual attempts on this device."
      : "The evidence stayed similar. Keep the coaching target and make the change more explicit next time.");
  }

  function handleRecordControl() {
    if (state.capability === "tavus") return;
    if (["ready", "idle"].includes(state.sessionState)) beginBrowserAnswer();
    else if (state.sessionState === "recording") finishBrowserAnswer();
    else if (state.sessionState === "text") analyzeTypedAnswer();
    else if (state.sessionState === "feedback" && state.attempts.length < 2) prepareBrowserAttempt();
    else if (state.sessionState === "feedback") finishBrowserSession();
  }

  function comparisonSummary() {
    if (state.attempts.length < 2) return "One complete attempt is saved on this device.";
    const [first, second] = state.attempts;
    const changes = [];
    if (second.fillers < first.fillers) changes.push(`${first.fillers - second.fillers} fewer filler${first.fillers - second.fillers === 1 ? "" : "s"}`);
    if (second.structure > first.structure) changes.push("a clearer answer structure");
    if (Number.isFinite(first.wpm) && Number.isFinite(second.wpm)) changes.push(`pace moved from ${first.wpm} to ${second.wpm} wpm`);
    return changes.length ? `Your second attempt had ${changes.join(" and ")}.` : "You completed two real attempts. Keep the same coaching target for the next session.";
  }

  function finishBrowserSession() {
    stopTimer();
    stopRecognitionAndMedia();
    if (!state.attempts.length) {
      resetToSetup();
      return;
    }
    const latest = state.attempts.at(-1);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        goal: state.goal, focus: state.focus, createdAt: new Date().toISOString(),
        attempts: state.attempts.map(({ transcript, source, words, duration, wpm, fillers, structure }) => ({ transcript, source, words, duration, wpm, fillers, structure })),
        coaching: latest.coaching,
      }));
    } catch {}
    renderReview(latest, comparisonSummary());
  }

  function renderReview(latest, summary, report = null) {
    setScreen("review");
    const second = state.attempts.length > 1;
    setText("review-title", second ? "You gave the answer a stronger second pass." : "You finished a real speaking attempt.");
    setText("review-lede", report?.summary || summary || `You practiced: ${state.goal}`);
    const coaching = latest?.coaching || state.pendingFeedback || {
      title: "Keep one clear through-line", body: "Lead with the point, explain your decision, and finish with what changed.", target: "Outcome → decision → evidence.",
    };
    setText("review-note-title", coaching.title || "One thing to carry forward");
    setText("review-note-body", coaching.body || report?.best_moment || "Your learning memory is being updated.");
    setText("review-target", coaching.target || report?.best_moment || state.goal);
    setText("review-attempts", state.attempts.length || report?.turns || 1);
    setText("review-wpm", Number.isFinite(latest?.wpm) ? `${latest.wpm} wpm` : "—");
    setText("review-fillers", Number.isFinite(latest?.fillers) ? latest.fillers : "—");
    const total = state.attempts.reduce((sum, item) => sum + (item.duration || 0), 0);
    setText("review-time", total ? formatTime(total) : formatTime((Date.now() - state.sessionStartedAt) / 1000));
    const transcriptRoot = $("review-transcript");
    transcriptRoot.replaceChildren();
    state.attempts.forEach((attempt, index) => {
      const row = document.createElement("article");
      row.className = "transcript-attempt";
      const label = document.createElement("span");
      label.textContent = `Attempt ${index + 1}`;
      const copy = document.createElement("p");
      copy.textContent = attempt.transcript || "Transcript unavailable";
      row.append(label, copy);
      transcriptRoot.append(row);
    });
  }

  function resetToSetup(keepGoal = false) {
    stopTimer();
    stopRecognitionAndMedia();
    destroyCall();
    state.conversationId = null;
    state.sessionStartedAt = 0;
    state.ending = false;
    if (!keepGoal) {
      state.goal = "";
      state.attempts = [];
    }
    setScreen("setup");
    renderRecent();
  }

  /* Tavus live conversation */
  function normalizeRole(role) {
    if (role === "user") return "user";
    if (["pal", "replica", "assistant"].includes(role)) return "coach";
    return null;
  }

  function eventKey(message) {
    return [message.event_type, message.seq ?? "", message.inference_id ?? "", normalizeRole(message.properties?.role) ?? ""].join(":");
  }

  function normalizeMessage(event) {
    const candidate = event?.data || event;
    if (typeof candidate === "string") {
      try { return JSON.parse(candidate); } catch { return {}; }
    }
    return candidate && typeof candidate === "object" ? candidate : {};
  }

  async function startTavusPractice() {
    $("browser-stage").hidden = false;
    $("video-stage").hidden = true;
    $("record-control").hidden = true;
    $("mic-toggle").hidden = false;
    $("camera-toggle").hidden = false;
    $("perception-tab").disabled = false;
    $("evidence").hidden = true;
    setText("attempt-label", "Private video room");
    setText("stage-mode", "Live conversation");
    setText("stage-kicker", "Opening your room");
    setText("stage-instruction", "Creating room → joining media → waiting for the conversation partner");
    setSessionState("creating", "Creating private room");
    if (!window.Daily?.createFrame) {
      state.capability = "browser";
      setText("stage-message", "Live video could not load. Continuing with speaking practice on this device.");
      $("stage-message").hidden = false;
      startBrowserPractice();
      return;
    }
    try {
      const room = await fetchJSON("/api/tavus/conversations", {
        method: "POST",
        body: JSON.stringify({ focus: state.focus, topic: state.goal }),
      });
      state.conversationId = room.conversation_id;
      sessionStorage.setItem("fluent-me:active-conversation", state.conversationId);
      setSessionState("joining", "Joining media");
      $("video-stage").hidden = false;
      const call = window.Daily.createFrame($("video-stage"), {
        showLeaveButton: false,
        showFullscreenButton: true,
        activeSpeakerMode: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
      });
      state.call = call;
      registerCallHandlers(call);
      await call.join({ url: room.conversation_url, token: room.meeting_token, startVideoOff: !$("camera-enabled").checked });
      setSessionState("waiting", "Waiting for coach");
      state.joinTimeout = setTimeout(() => {
        if (state.sessionState === "waiting") failLive("The coach did not join in time. You can retry or continue with on-device speaking practice.");
      }, 20000);
      const participants = call.participants?.() || {};
      if (Object.values(participants).some(participant => !participant.local)) activateLive();
    } catch (error) {
      await failLive(error.message || "We could not open the conversation.");
    }
  }

  function registerCallHandlers(call) {
    call.on("app-message", handleAppMessage);
    call.on("participant-joined", event => { if (event?.participant && !event.participant.local) activateLive(); });
    call.on("joined-meeting", () => setSessionState("waiting", "Waiting for coach"));
    call.on("left-meeting", () => { if (!state.ending && state.sessionState === "live") endLiveSession(); });
    call.on("error", event => failLive(event?.errorMsg || "The live room lost its connection."));
  }

  function activateLive() {
    clearTimeout(state.joinTimeout);
    state.joinTimeout = null;
    $("browser-stage").hidden = true;
    $("video-stage").hidden = false;
    state.sessionStartedAt = Date.now();
    setSessionState("live", "Your turn");
    startTimer("session");
  }

  async function failLive(message) {
    clearTimeout(state.joinTimeout);
    setSessionState("error", "Connection unavailable");
    await cleanupRemoteRoom();
    state.capability = "browser";
    $("browser-stage").hidden = false;
    $("video-stage").hidden = true;
    startBrowserPractice();
    $("stage-message").hidden = false;
    setText("stage-message", `${message} Continuing with speaking practice on this device.`);
  }

  function handleAppMessage(event) {
    const message = normalizeMessage(event);
    if (!message.event_type || (message.conversation_id && message.conversation_id !== state.conversationId)) return;
    const key = eventKey(message);
    if (state.seenEvents.has(key)) return;
    state.seenEvents.add(key);
    const props = message.properties || {};
    const role = normalizeRole(props.role);
    if (!role) return;
    if (message.event_type === "conversation.started_speaking") {
      state.speakerState = role;
      setSessionState("live", role === "user" ? "Listening" : "Coach is speaking");
      return;
    }
    if (message.event_type === "conversation.stopped_speaking") {
      state.speakerState = "none";
      setSessionState("live", role === "coach" ? "Your turn" : "Thinking");
      if (role === "coach" && state.pendingFeedback) {
        renderLiveFeedback(state.pendingFeedback);
        state.pendingFeedback = null;
      }
      return;
    }
    if (message.event_type !== "conversation.utterance") return;
    const speech = cleanTranscript(props.speech);
    if (!speech) return;
    showCaption(role, speech);
    if (role === "user") analyzeLiveTurn(message);
    else sendCoachEvent(message);
  }

  function showCaption(role, speech) {
    $("caption-strip").hidden = !state.captionsVisible;
    setText("caption-speaker", role === "user" ? "You" : "Coach");
    setText("caption-text", speech);
  }

  async function sendCoachEvent(message) {
    try {
      await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/events`, {
        method: "POST", body: JSON.stringify(message),
      });
    } catch {}
  }

  async function analyzeLiveTurn(message) {
    const props = message.properties || {};
    const speech = cleanTranscript(props.speech);
    if (props.user_audio_analysis) setText("audio-perception", props.user_audio_analysis);
    if (props.user_visual_analysis) setText("visual-perception", props.user_visual_analysis);
    setSessionState("live", "Reviewing your answer");
    try {
      const result = await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/turn`, {
        method: "POST",
        body: JSON.stringify({
          speech,
          seq: message.seq,
          inference_id: message.inference_id,
          turn_idx: message.turn_idx,
          audio_analysis: props.user_audio_analysis || "",
          visual_analysis: props.user_visual_analysis || "",
        }),
      });
      if (result.status === "processing") return;
      const feedback = {
        title: result.errors?.[0]?.label || result.errors?.[0]?.pattern?.replaceAll("-", " ") || "A more natural version",
        body: result.errors?.[0]?.explain || "Keep the meaning; make the phrasing easier to follow.",
        target: result.mirror_text || result.recast || result.native || speech,
        audio: result.mirror_audio,
        ownVoice: result.mirror_own_voice,
      };
      state.attempts.push({ transcript: speech, coaching: feedback, duration: null, wpm: null, fillers: null });
      if (state.speakerState === "coach") state.pendingFeedback = feedback;
      else renderLiveFeedback(feedback);
    } catch {
      setSessionState("live", "Your turn");
    }
  }

  function renderLiveFeedback(feedback) {
    $("note-empty").hidden = true;
    $("note-result").hidden = false;
    setText("note-title", feedback.title);
    setText("note-body", feedback.body);
    setText("note-target", feedback.target);
    state.latestFeedback = feedback;
    $("listen-button").hidden = !feedback.audio;
    setText("listen-label", feedback.ownVoice ? "Play in my voice" : "Listen to the rewrite");
  }

  async function playFeedback() {
    const audioUrl = state.latestFeedback?.audio;
    if (!audioUrl) return;
    if (state.currentAudio) state.currentAudio.pause();
    state.currentAudio = new Audio(audioUrl);
    try { await state.currentAudio.play(); } catch {}
  }

  async function destroyCall() {
    clearTimeout(state.joinTimeout);
    state.joinTimeout = null;
    if (!state.call) return;
    const call = state.call;
    state.call = null;
    try { await call.leave(); } catch {}
    try { await call.destroy(); } catch {}
  }

  async function cleanupRemoteRoom() {
    const conversationId = state.conversationId;
    await destroyCall();
    if (!conversationId) return;
    try {
      await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(conversationId)}/end`, { method: "POST", body: "{}" });
    } catch {}
    sessionStorage.removeItem("fluent-me:active-conversation");
    state.conversationId = null;
  }

  async function endLiveSession() {
    if (state.ending) return;
    state.ending = true;
    stopTimer();
    setSessionState("ending", "Saving what you practiced");
    const conversationId = state.conversationId;
    await destroyCall();
    let report = null;
    if (conversationId) {
      try {
        report = await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(conversationId)}/end`, { method: "POST", body: "{}" });
      } catch {}
    }
    sessionStorage.removeItem("fluent-me:active-conversation");
    state.conversationId = null;
    state.ending = false;
    renderReview(state.attempts.at(-1), "You kept the conversation moving and saved a useful correction.", report);
    if (conversationId && report?.status !== "ready") pollLiveReport(conversationId, 0);
  }

  async function pollLiveReport(conversationId, attempt) {
    if (attempt >= 7 || document.body.dataset.screen !== "review") return;
    await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 700));
    try {
      const report = await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(conversationId)}/report`, { headers: {} });
      if (report.summary) setText("review-lede", report.summary);
      if (report.best_moment) setText("review-target", report.best_moment);
      if (report.status !== "ready") pollLiveReport(conversationId, attempt + 1);
    } catch {}
  }

  function endSession() {
    if (state.capability === "tavus" && state.conversationId) endLiveSession();
    else finishBrowserSession();
  }

  function drawIdleWave() {
    cancelAnimationFrame(state.drawFrame);
    const canvas = $("voice-canvas");
    if (!canvas || canvas.hidden) return;
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(128,108,255,.08)");
    gradient.addColorStop(.5, "rgba(154,140,255,.52)");
    gradient.addColorStop(1, "rgba(64,217,173,.08)");
    context.strokeStyle = gradient;
    context.lineWidth = 3;
    context.beginPath();
    for (let x = 0; x <= width; x += 6) {
      const envelope = Math.sin(Math.PI * x / width);
      const y = height / 2 + Math.sin(x / 30) * 7 * envelope + Math.sin(x / 73) * 4 * envelope;
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  }

  async function startLiveWave() {
    if (!state.mediaStream) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audioContext = new AudioContext();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    state.audioContext.createMediaStreamSource(state.mediaStream).connect(state.analyser);
    const values = new Uint8Array(state.analyser.frequencyBinCount);
    const canvas = $("voice-canvas");
    const context = canvas.getContext("2d");
    const draw = () => {
      if (!state.analyser || state.sessionState !== "recording") return;
      state.analyser.getByteFrequencyData(values);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 64;
      const gap = 7;
      const barWidth = (canvas.width - gap * (bars - 1)) / bars;
      const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, "#5f51c8");
      gradient.addColorStop(.55, "#9a8cff");
      gradient.addColorStop(1, "#40d9ad");
      context.fillStyle = gradient;
      for (let index = 0; index < bars; index += 1) {
        const source = values[Math.floor(index / bars * values.length)] / 255;
        const height = Math.max(5, source * canvas.height * .72);
        const x = index * (barWidth + gap);
        context.beginPath();
        context.roundRect(x, (canvas.height - height) / 2, barWidth, height, barWidth / 2);
        context.fill();
      }
      state.drawFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  function togglePanel(button) {
    if (button.disabled) return;
    document.querySelectorAll(".panel-tab").forEach(tab => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $("coaching-panel").hidden = button.dataset.panel !== "coaching";
    $("perception-panel").hidden = button.dataset.panel !== "perception";
  }

  async function toggleMic() {
    if (!state.call) return;
    const next = !$("mic-toggle").classList.contains("off");
    await state.call.setLocalAudio(!next);
    $("mic-toggle").classList.toggle("off", next);
    setText("mic-toggle", next ? "Mic off" : "Mic");
  }

  async function toggleCamera() {
    if (!state.call) return;
    const next = !$("camera-toggle").classList.contains("off");
    await state.call.setLocalVideo(!next);
    $("camera-toggle").classList.toggle("off", next);
    setText("camera-toggle", next ? "Camera off" : "Camera");
  }

  document.querySelectorAll(".prompt-chip").forEach(button => button.addEventListener("click", () => selectPrompt(button)));
  document.querySelectorAll(".panel-tab").forEach(button => button.addEventListener("click", () => togglePanel(button)));
  $("practice-goal").addEventListener("input", () => document.querySelectorAll(".prompt-chip").forEach(chip => chip.classList.remove("selected")));
  $("start-button").addEventListener("click", startPractice);
  $("record-control").addEventListener("click", handleRecordControl);
  $("end-session").addEventListener("click", endSession);
  $("practice-again").addEventListener("click", () => {
    $("practice-goal").value = state.goal;
    startPractice();
  });
  $("new-goal").addEventListener("click", () => resetToSetup());
  $("listen-button").addEventListener("click", playFeedback);
  $("mic-toggle").addEventListener("click", toggleMic);
  $("camera-toggle").addEventListener("click", toggleCamera);
  $("transcript-toggle").addEventListener("click", () => {
    state.captionsVisible = !state.captionsVisible;
    $("live-words").hidden = !state.captionsVisible;
    if (!state.captionsVisible) $("caption-strip").hidden = true;
    $("transcript-toggle").classList.toggle("off", !state.captionsVisible);
  });

  window.addEventListener("resize", () => { if (state.sessionState !== "recording") drawIdleWave(); });
  window.addEventListener("pagehide", () => {
    stopRecognitionAndMedia();
    if (state.call) { try { state.call.leave(); } catch {} }
    if (state.conversationId) {
      fetch(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/end`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true,
      }).catch(() => {});
    }
  });

  boot();
})();
