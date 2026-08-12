(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const setText = (id, value) => {
    const node = $(id);
    if (node) node.textContent = value ?? "";
  };

  const COACH_REQUESTS = {
    sound: "How did my last spoken answer sound? Give me one specific English note and one more natural version. Keep it brief and useful.",
    natural: "Please restate the idea from my last spoken turn in natural English. Say the improved version clearly, then ask whether I want to try it.",
    signals: "Based only on observable signals from my most recent turn, how am I coming across? Mention specific pace, pauses, clarity, tone, and any visible cues you actually received. Be tentative, say when evidence is missing, and do not claim to know my inner emotion."
  };

  const state = {
    configured: false,
    call: null,
    conversationId: null,
    connecting: null,
    baseMode: "offline",
    micLive: false,
    cameraLive: false,
    ending: false,
    failureInProgress: false,
    seenEvents: new Set(),
    turns: [],
    timer: null,
    startedAt: 0,
    remoteReady: false
  };

  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
    }
    return payload;
  }

  function setView(view) {
    document.body.dataset.view = view;
    $("welcome").hidden = view !== "welcome";
    $("conversation").hidden = view !== "conversation";
    $("session-status").hidden = view !== "conversation";
    $("end-session").hidden = view !== "conversation";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setCoachState(mode, label) {
    document.body.dataset.coachMode = mode;
    setText("coach-state-label", label);
    setText("session-status-label", label);
  }

  function setCaption(role, text) {
    setText("caption-speaker", role === "user" ? "You" : "Coach");
    setText("caption-text", text);
  }

  function setWelcomeStatus(mode, title, detail) {
    document.body.dataset.coachMode = mode;
    setText("welcome-status", title);
    setText("welcome-status-detail", detail);
    setText("preview-badge", title);
  }

  function setControlsEnabled(enabled) {
    document.querySelectorAll(".coach-tool").forEach(button => { button.disabled = !enabled; });
    $("mic-toggle").disabled = !enabled;
    $("camera-toggle").disabled = !enabled;
    $("chat-input").disabled = !enabled;
    $("chat-form").querySelector("button").disabled = !enabled;
    $("phrase-input").disabled = !enabled;
    $("phrase-lab").querySelector("button").disabled = !enabled;
  }

  function updateMediaControls() {
    $("mic-toggle").setAttribute("aria-pressed", String(state.micLive));
    $("camera-toggle").setAttribute("aria-pressed", String(state.cameraLive));
    $("mic-toggle").querySelector("b").textContent = state.micLive ? "Mute mic" : "Turn mic on";
    $("camera-toggle").querySelector("b").textContent = state.cameraLive ? "Stop camera" : "Share camera";
    setText(
      "signal-scope",
      state.cameraLive
        ? "Your words, pacing, pauses, tone, and visible delivery cues."
        : state.micLive
          ? "Your words, pacing, pauses, and tone. Camera is off."
          : "Microphone and camera are off. You can still type to your coach."
    );
    if (!state.cameraLive) {
      $("self-video").hidden = true;
      $("self-video").srcObject = null;
    }
  }

  async function checkCapability() {
    try {
      const status = await fetchJSON("/api/tavus/status", { headers: {} });
      state.configured = Boolean(status.configured);
      if (state.configured) {
        setWelcomeStatus("available", "Coach available", "Video and microphone begin when you start.");
      } else if (status.has_key) {
        setWelcomeStatus("unavailable", "Coach unavailable", status.error || "Please try again in a moment.");
      } else {
        setWelcomeStatus("unavailable", "Coach unavailable", "Live coaching has not been configured yet.");
      }
    } catch {
      state.configured = false;
      setWelcomeStatus("unavailable", "Could not reach your coach", "Please try again in a moment.");
    }
    $("start-conversation").disabled = !state.configured;
  }

  function showTab(name) {
    const tools = name === "tools";
    $("tools-panel").hidden = !tools;
    $("log-panel").hidden = tools;
    $("tools-tab").classList.toggle("active", tools);
    $("log-tab").classList.toggle("active", !tools);
    $("tools-tab").setAttribute("aria-selected", String(tools));
    $("log-tab").setAttribute("aria-selected", String(!tools));
  }

  function readableTime(raw) {
    const number = Number(raw);
    let date = new Date();
    if (Number.isFinite(number) && number > 0) {
      date = new Date(number < 1e12 ? number * 1000 : number);
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function analysisText(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    try { return JSON.stringify(value); }
    catch { return String(value); }
  }

  function appendTurn({ role, text, timestamp, audioAnalysis, visualAnalysis }) {
    const speech = String(text || "").trim();
    if (!speech) return;
    $("empty-log").hidden = true;
    const article = document.createElement("article");
    article.className = `log-turn ${role}`;

    const header = document.createElement("header");
    const who = document.createElement("b");
    who.textContent = role === "user" ? "You" : "Coach";
    const time = document.createElement("time");
    time.textContent = readableTime(timestamp);
    header.append(who, time);

    const body = document.createElement("p");
    body.textContent = speech;
    article.append(header, body);

    const audio = analysisText(audioAnalysis);
    const visual = analysisText(visualAnalysis);
    if (audio || visual) {
      const details = document.createElement("details");
      details.className = "turn-signals";
      const summary = document.createElement("summary");
      summary.textContent = "Observable delivery signals";
      details.appendChild(summary);
      if (audio) {
        const line = document.createElement("p");
        line.textContent = `Audio: ${audio}`;
        details.appendChild(line);
      }
      if (visual) {
        const line = document.createElement("p");
        line.textContent = `Visual: ${visual}`;
        details.appendChild(line);
      }
      article.appendChild(details);
    }

    $("event-log").appendChild(article);
    state.turns.push({ role, text: speech });
    setText("log-count", String(state.turns.length));
    article.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function clearLogView() {
    $("event-log").querySelectorAll(".log-turn").forEach(node => node.remove());
    state.turns = [];
    $("empty-log").hidden = false;
    setText("log-count", "0");
  }

  function normalizeRole(role) {
    const value = String(role || "").toLowerCase();
    if (["pal", "replica", "assistant", "agent"].includes(value)) return "coach";
    if (["user", "participant", "human"].includes(value)) return "user";
    return value;
  }

  function roleForMessage(message) {
    const direct = normalizeRole(message.properties?.role);
    if (direct) return direct;
    const type = String(message.event_type || "");
    if (type.includes(".replica.") || type.includes(".pal.")) return "coach";
    if (type.includes(".user.")) return "user";
    return "";
  }

  function handleTavusMessage(event) {
    const message = event?.data || event;
    if (!message || typeof message !== "object") return;
    if (message.conversation_id && message.conversation_id !== state.conversationId) return;

    const type = String(message.event_type || "");
    const role = roleForMessage(message);
    const properties = message.properties || {};
    const speech = String(properties.speech || properties.text || properties.transcript || "").trim();

    if (type.includes("started_speaking")) {
      if (role === "coach") setCoachState("speaking", "Coach is speaking");
      if (role === "user") setCoachState("listening", "Listening to you");
      return;
    }

    if (type.includes("stopped_speaking")) {
      if (role === "user") setCoachState("thinking", "Thinking…");
      if (role === "coach") setCoachState("ready", "Your turn");
      return;
    }

    if (type === "conversation.utterance.streaming") {
      if (speech) setCaption(role || "coach", speech);
      return;
    }

    if (type !== "conversation.utterance" || !speech) return;
    const inference = String(message.inference_id || "");
    const key = `${inference || message.seq || "no-id"}|${role}|${speech}`;
    if (state.seenEvents.has(key)) return;
    state.seenEvents.add(key);

    const safeRole = role === "user" ? "user" : "coach";
    setCaption(safeRole, speech);
    appendTurn({
      role: safeRole,
      text: speech,
      timestamp: message.timestamp,
      audioAnalysis: properties.user_audio_analysis,
      visualAnalysis: properties.user_visual_analysis
    });
  }

  function remoteTracks(participant) {
    const video = participant?.tracks?.video?.persistentTrack || participant?.videoTrack || null;
    const audio = participant?.tracks?.audio?.persistentTrack || participant?.audioTrack || null;
    return { video, audio };
  }

  function attachRemoteMedia(participant) {
    if (!participant || participant.local) return false;
    const { video, audio } = remoteTracks(participant);
    const videoReady = participant.tracks?.video?.state === "playable" || Boolean(video);
    if (!videoReady || !video) return false;

    const stream = new MediaStream([video, audio].filter(Boolean));
    const player = $("tavus-video");
    const current = player.srcObject;
    const sameVideo = current instanceof MediaStream && current.getVideoTracks()[0]?.id === video.id;
    const sameAudio = current instanceof MediaStream && current.getAudioTracks()[0]?.id === audio?.id;
    if (sameVideo && sameAudio) return true;
    player.srcObject = stream;
    player.muted = false;
    player.play().catch(() => {
      player.muted = true;
      player.play().catch(() => {});
      setCaption("coach", "Video is connected. Tap the video once to turn on sound.");
    });
    return true;
  }

  function attachLocalMedia(participant) {
    if (!participant?.local || !state.cameraLive) return;
    const video = participant.tracks?.video?.persistentTrack || participant.videoTrack || null;
    if (!video) return;
    const preview = $("self-video");
    preview.srcObject = new MediaStream([video]);
    preview.hidden = false;
    preview.play().catch(() => {});
  }

  function stopTimer() {
    clearInterval(state.timer);
    state.timer = null;
  }

  function startTimer() {
    stopTimer();
    state.startedAt = Date.now();
    const tick = () => {
      const total = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
      const minutes = String(Math.floor(total / 60)).padStart(2, "0");
      const seconds = String(total % 60).padStart(2, "0");
      setText("session-timer", `${minutes}:${seconds}`);
    };
    tick();
    state.timer = setInterval(tick, 1000);
  }

  async function connectCoach() {
    if (state.baseMode === "live" && state.call) return true;
    if (state.connecting) return state.connecting;

    state.connecting = (async () => {
      $("connection-card").hidden = true;
      $("daily-stage").hidden = true;
      $("coach-still").hidden = false;
      state.remoteReady = false;
      setCoachState("connecting", "Connecting…");
      setControlsEnabled(false);

      try {
        if (!window.Daily) throw new Error("The secure video client did not load.");
        const room = await fetchJSON("/api/tavus/conversations", {
          method: "POST",
          body: JSON.stringify({ focus: "conversation", topic: "an open English conversation led by the learner" })
        });
        state.conversationId = room.conversation_id;

        const call = window.Daily.createCallObject({
          subscribeToTracksAutomatically: true
        });
        state.call = call;
        call.on("app-message", handleTavusMessage);
        call.on("error", event => {
          const detail = event?.errorMsg || event?.error?.msg || "The video connection failed.";
          void failConnection(detail);
        });
        call.on("left-meeting", () => {
          if (!state.ending && document.body.dataset.view === "conversation") {
            void failConnection("The video room ended. Try reconnecting to continue.");
          }
        });

        let resolveRemote;
        let rejectRemote;
        const remoteJoined = new Promise((resolve, reject) => {
          resolveRemote = resolve;
          rejectRemote = reject;
        });
        // If join itself fails before we await the remote participant, the
        // timeout rejection is still handled instead of becoming global noise.
        remoteJoined.catch(() => {});
        const timeout = setTimeout(() => rejectRemote(new Error("Your coach did not appear in time. Try again.")), 30000);
        const acceptParticipant = participant => {
          if (participant?.local) {
            attachLocalMedia(participant);
            return;
          }
          if (!attachRemoteMedia(participant)) return;
          if (!state.remoteReady) {
            state.remoteReady = true;
            clearTimeout(timeout);
            resolveRemote(true);
          }
        };

        call.on("participant-joined", event => acceptParticipant(event?.participant));
        call.on("participant-updated", event => acceptParticipant(event?.participant));
        call.on("participant-left", event => {
          if (!state.ending && event?.participant && !event.participant.local) {
            void failConnection("Your coach left the room. Try reconnecting to continue.");
          }
        });

        $("daily-stage").hidden = false;
        $("daily-stage").classList.add("pending");
        await call.join({
          url: room.conversation_url,
          token: room.meeting_token,
          userName: "Fluent Me learner",
          startVideoOff: true,
          startAudioOff: false
        });
        state.micLive = true;
        state.cameraLive = false;
        updateMediaControls();
        Object.values(call.participants?.() || {}).forEach(acceptParticipant);
        await remoteJoined;

        state.baseMode = "live";
        $("daily-stage").classList.remove("pending");
        $("coach-still").hidden = true;
        setCoachState("ready", "Your turn");
        setControlsEnabled(true);
        startTimer();
        return true;
      } catch (error) {
        await failConnection(error.message || "Your coach could not join.");
        return false;
      } finally {
        state.connecting = null;
      }
    })();

    return state.connecting;
  }

  function showConnectionFailure(detail) {
    state.baseMode = "offline";
    $("daily-stage").hidden = true;
    $("coach-still").hidden = false;
    $("connection-card").hidden = false;
    setText("connection-copy", detail || "Check microphone access and try again.");
    setCoachState("unavailable", "Not connected");
    setControlsEnabled(false);
  }

  async function failConnection(detail) {
    if (state.failureInProgress || state.ending) return;
    state.failureInProgress = true;
    try {
      await destroyCall(true);
      showConnectionFailure(detail);
    } finally {
      state.failureInProgress = false;
    }
  }

  async function destroyCall(endRemote = true) {
    const call = state.call;
    const conversationId = state.conversationId;
    state.call = null;
    state.conversationId = null;
    state.baseMode = "offline";
    state.remoteReady = false;
    state.micLive = false;
    state.cameraLive = false;
    stopTimer();
    updateMediaControls();

    const remote = $("tavus-video");
    remote.pause();
    remote.srcObject = null;
    const local = $("self-video");
    local.pause();
    local.srcObject = null;
    local.hidden = true;

    if (call) {
      try { await call.leave(); } catch {}
      try { await call.destroy(); } catch {}
    }
    if (endRemote && conversationId) {
      try {
        await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(conversationId)}/end`, {
          method: "POST",
          body: "{}"
        });
      } catch {}
    }
  }

  async function sendInteraction(eventType, text) {
    const message = String(text || "").trim();
    if (!message || state.baseMode !== "live" || !state.call || !state.conversationId) {
      setCaption("coach", "Connect your coach first, or try again in a moment.");
      return false;
    }
    try {
      await state.call.sendAppMessage({
        message_type: "conversation",
        event_type: eventType,
        conversation_id: state.conversationId,
        properties: eventType === "conversation.echo"
          ? { modality: "text", text: message, done: true }
          : { text: message }
      }, "*");
      return true;
    } catch {
      setCaption("coach", "That request did not go through. Please say it out loud or try again.");
      return false;
    }
  }

  async function askCoach(text, visibleText = text) {
    setCaption("user", visibleText);
    setCoachState("thinking", "Thinking…");
    await sendInteraction("conversation.respond", text);
  }

  async function modelPhrase(text) {
    setCaption("coach", text);
    setCoachState("speaking", "Coach is speaking");
    await sendInteraction("conversation.echo", text);
  }

  async function toggleMicrophone() {
    if (!state.call || state.baseMode !== "live") return;
    const next = !state.micLive;
    try {
      await Promise.resolve(state.call.setLocalAudio(next));
      state.micLive = next;
      updateMediaControls();
      setCoachState(next ? "ready" : "thinking", next ? "Your turn" : "Mic is off");
    } catch {
      setCaption("coach", "Microphone access was blocked. Allow it in your browser or type below.");
    }
  }

  async function toggleCamera() {
    if (!state.call || state.baseMode !== "live") return;
    const next = !state.cameraLive;
    try {
      await Promise.resolve(state.call.setLocalVideo(next));
      state.cameraLive = next;
      updateMediaControls();
      if (next) {
        const local = state.call.participants?.()?.local;
        attachLocalMedia(local);
        setCaption("coach", "Camera is on. I can now use visible delivery cues too.");
      } else {
        setCaption("coach", "Camera is off. I can still hear your words, pace, pauses, and tone.");
      }
    } catch {
      state.cameraLive = false;
      updateMediaControls();
      setCaption("coach", "Camera access was blocked. You can keep talking with audio only.");
    }
  }

  async function startConversation() {
    if (!state.configured) return;
    state.ending = false;
    state.seenEvents.clear();
    clearLogView();
    showTab("tools");
    setView("conversation");
    setCaption("coach", "Your coach will start with one question. Then the conversation is yours.");
    await connectCoach();
  }

  async function endSession() {
    if (state.ending) return;
    state.ending = true;
    setCoachState("thinking", "Ending session…");
    await destroyCall(true);
    $("daily-stage").hidden = true;
    $("coach-still").hidden = false;
    $("connection-card").hidden = true;
    setText("session-timer", "00:00");
    setView("welcome");
    state.ending = false;
    await checkCapability();
  }

  $("start-conversation").addEventListener("click", startConversation);
  $("end-session").addEventListener("click", endSession);
  $("retry-connection").addEventListener("click", connectCoach);
  $("mic-toggle").addEventListener("click", toggleMicrophone);
  $("camera-toggle").addEventListener("click", toggleCamera);
  $("tools-tab").addEventListener("click", () => showTab("tools"));
  $("log-tab").addEventListener("click", () => showTab("log"));
  $("clear-log").addEventListener("click", clearLogView);
  $("open-phrase-lab").addEventListener("click", () => {
    $("phrase-lab").hidden = !$("phrase-lab").hidden;
    if (!$("phrase-lab").hidden) $("phrase-input").focus();
  });

  document.querySelectorAll("[data-coach-request]").forEach(button => {
    button.addEventListener("click", () => {
      const key = button.dataset.coachRequest;
      const visible = button.querySelector("b")?.textContent || "Coach request";
      void askCoach(COACH_REQUESTS[key], visible);
    });
  });

  $("phrase-lab").addEventListener("submit", event => {
    event.preventDefault();
    const phrase = $("phrase-input").value.trim();
    if (!phrase) {
      $("phrase-input").focus();
      return;
    }
    void modelPhrase(phrase);
  });

  $("chat-form").addEventListener("submit", event => {
    event.preventDefault();
    const text = $("chat-input").value.trim();
    if (!text) return;
    $("chat-input").value = "";
    void askCoach(text);
  });

  $("tavus-video").addEventListener("click", () => {
    const video = $("tavus-video");
    if (video.muted) {
      video.muted = false;
      video.play().catch(() => {});
    }
  });

  window.addEventListener("beforeunload", () => {
    if (!state.conversationId) return;
    fetch(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      keepalive: true
    }).catch(() => {});
  });

  setControlsEnabled(false);
  updateMediaControls();
  checkCapability();
})();
