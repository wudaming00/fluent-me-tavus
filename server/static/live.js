(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const state = {
    mode: "booting",
    configured: false,
    focus: "conversation",
    call: null,
    conversationId: null,
    startedAt: 0,
    timerId: null,
    reportId: null,
    transcriptCount: 0,
    seenEvents: new Set(),
    currentAudio: null,
    mirrorAudio: null,
    ending: false,
  };

  const SAMPLE = {
    user: "Last weekend I go to a networking event and I meet a founder.",
    pal: "That sounds like a useful event. What did you two end up talking about?",
    audio: "Delivery became more tentative around the past-tense phrase.",
    visual: "The learner is facing the screen; no relevant object is being shown.",
    scores: { composite: 68, dims: { grammar: 58, vocab: 82, fluency: null, pron: null } },
    mirror: "Last weekend I went to a networking event and met a founder.",
    errors: ["past tense"],
  };

  function setRoomState(next, label) {
    state.mode = next;
    document.body.dataset.roomState = next;
    if (label) $("stage-state").textContent = label;
  }

  function setText(id, value) {
    $(id).textContent = value == null ? "" : String(value);
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function beginClock() {
    state.startedAt = Date.now();
    $("live-clock").hidden = false;
    clearInterval(state.timerId);
    state.timerId = setInterval(() => setText("timer", formatTime((Date.now() - state.startedAt) / 1000)), 1000);
  }

  function stopClock() {
    clearInterval(state.timerId);
    state.timerId = null;
    $("live-clock").hidden = true;
  }

  function setStartButton(label, disabled = false) {
    setText("start-button", label);
    $("start-button").disabled = disabled;
  }

  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(body.error || `Request failed (${response.status})`);
      error.reason = body.reason;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function textNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function renderMemoryTargets(data) {
    const root = $("memory-targets");
    root.replaceChildren();
    const patterns = Array.isArray(data) ? data.filter(Boolean).slice(0, 3) : [];
    if (!patterns.length) {
      root.append(textNode("span", "memory-target empty", "No due patterns — open conversation today"));
      return;
    }
    patterns.forEach(pattern => root.append(textNode("span", "memory-target", pattern.replaceAll("-", " "))));
  }

  async function loadLearningState() {
    try {
      const profile = await fetchJSON("/api/cards", { headers: {} });
      const now = Number(profile.now || Date.now() / 1000);
      const due = (profile.cards || [])
        .filter(card => card.status === "learning" && Number(card.due_at || 0) <= now)
        .map(card => card.label || card.pattern);
      renderMemoryTargets(due);
    } catch {
      renderMemoryTargets([]);
    }
  }

  function updateConnectionUI() {
    document.body.dataset.liveReady = state.configured ? "true" : "false";
    setText("connection-label", state.configured ? "Tavus ready" : "Preview · Tavus not connected");
    $("preview-label").textContent = state.configured ? "Private room · camera optional" : "Preview mode · sample signals";
    if (state.configured) {
      setStartButton("Start live session");
      setText("stage-copy-kicker", "Private Tavus room");
      setText("stage-title", "Step into a real conversation with Kai.");
      setText("stage-description", "Raven supplies live context, Sparrow manages turns, and Fluent Me learns beside the call.");
      setRoomState("ready", "Ready for a private session");
    } else {
      setStartButton("Enter guided preview");
      setText("stage-copy-kicker", "Interactive product preview");
      setText("stage-title", "See how perception becomes useful—not performative.");
      setText("stage-description", "This preview uses clearly labelled sample observations. Add a fresh server-side Tavus key for a real call.");
      setRoomState("ready", "Preview available");
    }
  }

  async function boot() {
    await loadLearningState();
    try {
      const status = await fetchJSON("/api/tavus/status", { headers: {} });
      state.configured = Boolean(status.configured);
    } catch {
      state.configured = false;
    }
    updateConnectionUI();
  }

  function chooseFocus(button) {
    document.querySelectorAll(".focus-chip").forEach(chip => chip.classList.toggle("selected", chip === button));
    state.focus = button.dataset.focus;
  }

  function resetSignals() {
    setText("audio-perception", "Waiting for a complete user turn.");
    setText("visual-perception", $("camera-enabled").checked
      ? "Camera context will appear here when available."
      : "Camera is off. Visual context is not being collected.");
  }

  function setSpeaking(role, active) {
    if (!active) {
      $("speaking-cue").hidden = true;
      if (state.mode === "live") setText("stage-state", "Listening for the next turn");
      return;
    }
    const user = role === "user";
    setText("speaking-label", user ? "You are speaking" : "Kai is speaking");
    setText("stage-state", user ? "Listening" : "Kai is responding");
    $("speaking-cue").hidden = false;
  }

  function appendTranscript(role, speech, meta = "") {
    if (!speech) return;
    $("transcript-empty").hidden = true;
    const row = document.createElement("article");
    row.className = `transcript-turn ${role === "user" ? "user" : "pal"}`;
    const who = document.createElement("span");
    who.className = "transcript-speaker";
    who.append(document.createElement("i"), document.createTextNode(role === "user" ? "You" : "Kai"));
    row.append(who, textNode("p", "transcript-text", speech),
      textNode("span", "transcript-meta", meta || formatTime((Date.now() - state.startedAt) / 1000)));
    $("transcript").append(row);
    state.transcriptCount += 1;
    setText("transcript-count", `${state.transcriptCount} utterance${state.transcriptCount === 1 ? "" : "s"}`);
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function setScoreValue(name, value) {
    setText(`score-${name}`, value == null ? "n/a" : Math.round(value));
    const bar = $(`bar-${name}`);
    if (bar) bar.style.width = `${value == null ? 0 : Math.max(0, Math.min(100, value))}%`;
  }

  function renderScores(scores, degraded = false) {
    const dims = scores?.dims || {};
    setText("turn-score", scores?.composite == null ? "—" : Math.round(scores.composite));
    setText("score-caption", degraded ? "Coach analysis unavailable" : "Latest language evidence");
    setText("score-note", "Grammar and vocabulary only. Raven context is excluded from grading.");
    setScoreValue("grammar", dims.grammar);
    setScoreValue("vocab", dims.vocab);
    setScoreValue("fluency", null);
    setScoreValue("pron", null);
  }

  function stopMirrorAudio() {
    if (state.currentAudio) {
      state.currentAudio.pause();
      state.currentAudio = null;
    }
    setText("mirror-play", "");
  }

  function renderMirror(before, after, audioUrl, engine, ownVoice) {
    $("mirror-empty").hidden = true;
    $("mirror-result").hidden = false;
    setText("mirror-before", before);
    setText("mirror-after", after || before);
    state.mirrorAudio = audioUrl || null;
    const button = $("mirror-play");
    button.disabled = !audioUrl;
    button.replaceChildren();
    button.append(textNode("span", "", audioUrl ? "▶" : "·"));
    const label = textNode("b", "", audioUrl ? "Hear the fluent me" : "Mirror audio unavailable");
    const detail = textNode("small", "", ownVoice ? "Your cloned voice" : (audioUrl ? "Fallback voice · clone pending" : "Add ElevenLabs or local TTS"));
    if (engine) detail.title = engine;
    button.append(label, detail);
  }

  function playMirror() {
    if (!state.mirrorAudio) return;
    if (state.currentAudio) state.currentAudio.pause();
    const audio = new Audio(state.mirrorAudio);
    state.currentAudio = audio;
    const button = $("mirror-play");
    const icon = button.querySelector("span");
    if (icon) icon.textContent = "■";
    audio.onended = audio.onerror = () => {
      if (state.currentAudio === audio) state.currentAudio = null;
      if (icon) icon.textContent = "▶";
    };
    audio.play().catch(() => { if (icon) icon.textContent = "▶"; });
  }

  function renderPerception(audio, visual, sample = false) {
    if (audio) setText("audio-perception", `${sample ? "Sample · " : ""}${audio}`);
    if (visual) setText("visual-perception", `${sample ? "Sample · " : ""}${visual}`);
  }

  function eventKey(message) {
    return [message.event_type, message.seq ?? "", message.inference_id ?? "", message.properties?.role ?? ""].join(":");
  }

  function normalizeMessage(event) {
    const candidate = event?.data || event;
    if (typeof candidate === "string") {
      try { return JSON.parse(candidate); } catch { return {}; }
    }
    return candidate && typeof candidate === "object" ? candidate : {};
  }

  async function sendPalEvent(message) {
    try {
      await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/events`, {
        method: "POST", body: JSON.stringify(message),
      });
    } catch {}
  }

  async function analyzeUserTurn(message) {
    const props = message.properties || {};
    const speech = String(props.speech || "").trim();
    if (!speech) return;
    appendTranscript("user", speech);
    renderPerception(props.user_audio_analysis, props.user_visual_analysis);
    setText("score-caption", "Analyzing this turn…");
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
      renderScores(result.scores, result.degraded);
      if (result.mirror_text) renderMirror(speech, result.mirror_text, result.mirror_audio,
        result.mirror_engine, result.mirror_own_voice);
      loadLearningState();
    } catch (error) {
      setText("score-caption", "Turn analysis unavailable");
      setText("score-note", error.message);
    }
  }

  function handleAppMessage(event) {
    const message = normalizeMessage(event);
    if (!message.event_type || (message.conversation_id && message.conversation_id !== state.conversationId)) return;
    const key = eventKey(message);
    if (state.seenEvents.has(key)) return;
    state.seenEvents.add(key);
    const props = message.properties || {};
    if (props.role === "replica") return;

    if (message.event_type === "conversation.started_speaking") {
      setSpeaking(props.role, true);
      return;
    }
    if (message.event_type === "conversation.stopped_speaking") {
      setSpeaking(props.role, false);
      return;
    }
    if (message.event_type !== "conversation.utterance") return;
    const speech = String(props.speech || "").trim();
    if (props.role === "user") analyzeUserTurn(message);
    if (props.role === "pal") {
      appendTranscript("pal", speech);
      sendPalEvent(message);
    }
  }

  function registerCallHandlers(call) {
    call.on("app-message", handleAppMessage);
    call.on("joined-meeting", () => {
      setRoomState("live", "Listening for the first turn");
      $("live-clock").hidden = false;
      $("end-button").hidden = false;
      setText("room-note", "Live Tavus room · camera optional · microphone on");
      beginClock();
    });
    call.on("left-meeting", () => { if (!state.ending) endSession(); });
    call.on("error", event => {
      setRoomState("error", "Kai couldn’t join this room");
      setText("room-note", event?.errorMsg || "Retry, or continue in the guided preview.");
      setStartButton("Retry live session");
    });
  }

  async function startLive() {
    setRoomState("joining", "Bringing Kai into the room…");
    setStartButton("Connecting…", true);
    $("camera-choice").style.pointerEvents = "none";
    setText("room-note", "This usually takes 5–20 seconds.");
    resetSignals();
    try {
      const room = await fetchJSON("/api/tavus/conversations", {
        method: "POST", body: JSON.stringify({ focus: state.focus }),
      });
      state.conversationId = room.conversation_id;
      const call = window.Daily.createFrame($("video-stage"), {
        showLeaveButton: false,
        showFullscreenButton: true,
        activeSpeakerMode: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
      });
      state.call = call;
      registerCallHandlers(call);
      $("video-stage").classList.add("daily-mounted");
      await call.join({
        url: room.conversation_url,
        token: room.meeting_token,
        startVideoOff: !$("camera-enabled").checked,
      });
    } catch (error) {
      state.ending = false;
      setRoomState("error", "Kai couldn’t join this room");
      setText("room-note", error.message || "Try again, or enter the guided preview.");
      setStartButton("Retry live session");
      $("start-button").disabled = false;
      $("camera-choice").style.pointerEvents = "";
      if (error.reason === "not_configured" || error.status === 401 || error.status === 403) openConnectionDialog();
    }
  }

  function startPreview() {
    setRoomState("preview", "Guided preview · sample data");
    setStartButton("Preview running", true);
    $("camera-choice").style.pointerEvents = "none";
    $("sample-button").hidden = false;
    $("end-button").hidden = false;
    $("live-clock").hidden = false;
    setText("room-note", "Preview mode uses sample signals and does not access your camera or microphone.");
    setText("stage-copy-kicker", "Preview is ready");
    setText("stage-title", "Try one complete learning turn.");
    setText("stage-description", "Press “Run sample turn” below. Every observation and score will remain clearly labelled as sample data.");
    $("camera-choice").hidden = true;
    $("stage-actions").hidden = true;
    beginClock();
  }

  async function runSampleTurn() {
    const button = $("sample-button");
    button.disabled = true;
    setSpeaking("user", true);
    await new Promise(resolve => setTimeout(resolve, 700));
    appendTranscript("user", SAMPLE.user, "sample");
    setSpeaking("user", false);
    renderPerception(SAMPLE.audio, SAMPLE.visual, true);
    setText("score-caption", "Analyzing sample turn…");
    await new Promise(resolve => setTimeout(resolve, 800));
    renderScores(SAMPLE.scores);
    renderMirror(SAMPLE.user, SAMPLE.mirror, null, "Preview only", false);
    setSpeaking("pal", true);
    await new Promise(resolve => setTimeout(resolve, 700));
    appendTranscript("pal", SAMPLE.pal, "sample");
    setSpeaking("pal", false);
    renderMemoryTargets(["tense past simple", "concise interview story"]);
    setText("score-note", "Sample grammar and vocabulary evidence. Perception did not affect the score.");
    button.textContent = "Run another sample";
    button.disabled = false;
  }

  async function destroyCall() {
    if (!state.call) return;
    const call = state.call;
    state.call = null;
    try { await call.leave(); } catch {}
    try { call.destroy(); } catch {}
    $("video-stage").classList.remove("daily-mounted");
  }

  function renderReport(report) {
    $("report-card").hidden = false;
    $("report-card").scrollIntoView({ behavior: "smooth", block: "start" });
    setText("report-turns", report.turns ?? 0);
    setText("report-score", report.avg ?? "—");
    setText("report-cards", report.cards_created ?? 0);
    setText("report-xp", report.xp_gained ?? 0);
    if (report.status === "ready") {
      setText("report-title", "Nice work. Your learning memory is updated.");
      setText("report-summary", report.summary || "The session is saved and ready to revisit.");
    } else {
      setText("report-title", "Nice work. Finalizing your recap…");
      setText("report-summary", "The call has ended; transcript and memory are still being distilled.");
    }
  }

  async function pollReport() {
    clearTimeout(state.reportId);
    if (!state.conversationId) return;
    try {
      const report = await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/report`, { headers: {} });
      renderReport(report);
      if (report.status !== "ready") state.reportId = setTimeout(pollReport, 1500);
    } catch {}
  }

  function previewReport() {
    renderReport({ status: "ready", turns: 1, avg: 68, cards_created: 1, xp_gained: 14,
      summary: "Sample recap: the learner told a recent story and practiced consistent past tense. In a live room, this would now be stored for future conversational review." });
  }

  async function endSession() {
    if (state.ending || !["live", "preview", "joining"].includes(state.mode)) return;
    state.ending = true;
    setRoomState("ending", "Ending the session…");
    $("end-button").disabled = true;
    $("sample-button").hidden = true;
    stopClock();
    if (state.mode === "preview" || !state.conversationId) {
      previewReport();
      setRoomState("ended", "Preview complete");
      state.ending = false;
      return;
    }
    await destroyCall();
    try {
      const report = await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/end`, {
        method: "POST", body: "{}",
      });
      renderReport(report);
      pollReport();
      setRoomState("ended", "Session ended · finalizing recap");
    } catch (error) {
      setRoomState("error", "Call ended; recap needs attention");
      setText("room-note", error.message);
    } finally {
      state.ending = false;
    }
  }

  async function restart() {
    clearTimeout(state.reportId);
    await destroyCall();
    state.conversationId = null;
    state.ending = false;
    state.transcriptCount = 0;
    state.seenEvents.clear();
    state.mirrorAudio = null;
    $("transcript").querySelectorAll(".transcript-turn").forEach(node => node.remove());
    $("transcript-empty").hidden = false;
    setText("transcript-count", "No turns yet");
    $("report-card").hidden = true;
    $("mirror-empty").hidden = false;
    $("mirror-result").hidden = true;
    $("sample-button").hidden = true;
    $("end-button").hidden = true;
    $("end-button").disabled = false;
    $("camera-choice").hidden = false;
    $("camera-choice").style.pointerEvents = "";
    $("stage-actions").hidden = false;
    resetSignals();
    renderScores(null);
    updateConnectionUI();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openConnectionDialog() {
    const dialog = $("connection-dialog");
    if (!dialog.open) dialog.showModal();
  }
  function closeConnectionDialog() { $("connection-dialog").close(); }

  document.querySelectorAll(".focus-chip").forEach(button => button.addEventListener("click", () => chooseFocus(button)));
  $("connection-pill").addEventListener("click", openConnectionDialog);
  $("guide-button").addEventListener("click", openConnectionDialog);
  $("dialog-close").addEventListener("click", closeConnectionDialog);
  $("dialog-done").addEventListener("click", closeConnectionDialog);
  $("connection-dialog").addEventListener("click", event => {
    if (event.target === $("connection-dialog")) closeConnectionDialog();
  });
  $("start-button").addEventListener("click", () => state.configured ? startLive() : startPreview());
  $("sample-button").addEventListener("click", runSampleTurn);
  $("end-button").addEventListener("click", endSession);
  $("restart-button").addEventListener("click", restart);
  $("mirror-play").addEventListener("click", playMirror);
  $("camera-enabled").addEventListener("change", resetSignals);
  window.addEventListener("pagehide", () => {
    if (state.call) {
      try { state.call.leave(); } catch {}
    }
    if (state.conversationId && state.mode === "live") {
      fetch(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/end`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true,
      }).catch(() => {});
    }
  });

  boot();
})();
