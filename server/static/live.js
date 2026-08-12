(() => {
  "use strict";

  const LESSON = [
    {
      target: "Tavus is more than a digital face.",
      translation: "Meaning: The visible face is only one part of Tavus.",
      chunks: ["Tavus is more than", "a digital face"],
      fixChunk: "more than a digital face",
      fixTitle: "Connect this phrase as one thought",
      fixCopy: "Keep “more than” together. Listen once, then say the whole phrase without a pause.",
      recallCue: "Say this idea in English from memory: the visible face is only one part of Tavus.",
      useQuestion: "If Tavus is more than a digital face, what is the real product?"
    },
    {
      target: "The face is the interface; the real product is the system behind it.",
      translation: "Meaning: The visible face is the interface; the product is the system behind it.",
      chunks: ["The face is the interface", "the real product", "is the system behind it"],
      fixChunk: "the system behind it",
      fixTitle: "Stress “system”",
      fixCopy: "“Face” is the surface; “system” is the contrast. Make “system” clearer than the words around it.",
      recallCue: "Say this idea in English from memory: the face is the interface, and the product is the system behind it.",
      useQuestion: "What do you mean by the system behind the face?"
    },
    {
      target: "It combines perception, memory, and orchestration to make conversations feel responsive.",
      translation: "Meaning: Several AI capabilities work together to make the conversation responsive.",
      chunks: ["It combines perception", "memory and orchestration", "to make conversations feel responsive"],
      fixChunk: "perception, memory, and orchestration",
      fixTitle: "Give the three capabilities a clear rhythm",
      fixCopy: "Treat “perception,” “memory,” and “orchestration” as three even beats. Do not rush them together.",
      recallCue: "Say this idea in English from memory: perception, memory, and orchestration work together to make conversation responsive.",
      useQuestion: "How do perception, memory, and orchestration change the user experience?"
    }
  ];

  const STEPS = ["listen", "repeat", "fix", "recall", "use"];
  const STEP_COPY = {
    listen: {
      index: "Step 1 of 5 · LISTEN",
      title: "Listen first. You do not need to speak yet.",
      instruction: "Watch your coach and notice the natural thought groups.",
      primary: "My turn",
      secondary: "Listen again",
      help: "When the phrase feels clear, press “My turn.”"
    },
    repeat: {
      index: "Step 2 of 5 · REPEAT",
      title: "Repeat the full sentence. It does not need to be perfect.",
      instruction: "Keep the rhythm and say the complete idea first.",
      primary: "Start repeating",
      secondary: "Type instead",
      help: "Press to speak. Pause when you finish, or press “Done.”"
    },
    fix: {
      index: "Step 3 of 5 · FIX ONE THING",
      title: "Practice only this short phrase.",
      instruction: "One focused change is more useful than a wall of scores.",
      primary: "Practice this phrase",
      secondary: "Hear this phrase",
      help: "Listen once, then match your coach’s rhythm."
    },
    recall: {
      index: "Step 4 of 5 · RECALL",
      title: "Now hide the sentence and express the same idea.",
      instruction: "The wording can change. Retrieve the idea from memory.",
      primary: "Speak from memory",
      secondary: "Give me a hint",
      help: "The model sentence is hidden; use the meaning cue."
    },
    use: {
      index: "Step 5 of 5 · USE",
      title: "Use the new phrase in your answer.",
      instruction: "Your coach will ask a real question. Answer with your own ideas.",
      primary: "Answer the coach",
      secondary: "Hear the question again",
      help: "Try to use the new phrase, but make the answer your own."
    }
  };

  const $ = id => document.getElementById(id);
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = value ?? ""; };

  const state = {
    sentenceIndex: 0,
    step: "listen",
    stepComplete: false,
    configured: false,
    baseMode: "offline",
    call: null,
    conversationId: null,
    connecting: null,
    recognition: null,
    transcript: "",
    mediaRecorder: null,
    mediaStream: null,
    audioChunks: [],
    currentAudioUrl: null,
    silenceTimer: null,
    recording: false,
    records: LESSON.map(() => ({})),
    pendingCoachText: "",
    coachRestoreTimer: null,
    failureInProgress: false
  };

  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
    return payload;
  }

  function setView(view) {
    document.body.dataset.view = view;
    $("welcome").hidden = view !== "welcome";
    $("lesson").hidden = view !== "lesson";
    $("complete").hidden = view !== "complete";
    $("lesson-progress").hidden = view !== "lesson";
    $("exit-button").hidden = view !== "lesson";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setCoachVisual(mode, label) {
    document.body.dataset.coachMode = mode;
    setText("coach-state-label", label);
  }

  function restoreCoachState() {
    if (state.baseMode === "tavus-live") {
      setCoachVisual("tavus-live", "Live Tavus video coach connected");
    } else {
      setCoachVisual("offline", "Waiting for Tavus video coach");
    }
  }

  function setWelcomeStatus(mode, title, detail) {
    document.body.dataset.coachMode = mode;
    setText("welcome-status", title);
    setText("welcome-status-detail", detail);
  }

  async function checkCapability() {
    try {
      const status = await fetchJSON("/api/tavus/status", { headers: {} });
      state.configured = Boolean(status.configured);
      if (state.configured) {
        setWelcomeStatus("tavus-ready", "Tavus is ready", "We will connect when you start. “Live” appears only after the remote video is playable.");
      } else if (status.has_key) {
        setWelcomeStatus("unavailable", "Tavus credential was rejected", status.error || "Rotate the server credential, then reconnect.");
      } else {
        setWelcomeStatus("offline", "Live Tavus is not configured", "A placeholder face will never be shown as a live coach.");
      }
    } catch {
      state.configured = false;
      setWelcomeStatus("unavailable", "Could not check Tavus", "You can review the lesson, but live coaching requires Tavus.");
    }
  }

  function currentLesson() { return LESSON[state.sentenceIndex]; }

  function updateStepper() {
    const current = STEPS.indexOf(state.step);
    document.querySelectorAll(".stepper li").forEach((item, index) => {
      item.classList.toggle("active", index === current);
      item.classList.toggle("done", index < current);
      const number = item.querySelector(":scope > span");
      if (number) number.textContent = index < current ? "✓" : String(index + 1);
    });
  }

  function renderChunks(chunks) {
    const root = $("chunks");
    root.replaceChildren();
    chunks.forEach(chunk => {
      const chip = document.createElement("span");
      chip.textContent = chunk;
      root.appendChild(chip);
    });
  }

  function resetCaptureUI() {
    $("capture-result").hidden = true;
    $("text-entry").hidden = true;
    $("task-note").hidden = true;
    $("typed-answer").value = "";
    $("play-recording").hidden = true;
    $("primary-action").hidden = false;
    $("secondary-action").hidden = false;
    state.stepComplete = false;
    state.transcript = "";
    if (state.currentAudioUrl) {
      URL.revokeObjectURL(state.currentAudioUrl);
      state.currentAudioUrl = null;
    }
  }

  function renderStep({ announce = false } = {}) {
    const lesson = currentLesson();
    const copy = STEP_COPY[state.step];
    document.body.dataset.lessonStep = state.step;
    setText("sentence-count", `Sentence ${state.sentenceIndex + 1} of ${LESSON.length}`);
    setText("task-index", copy.index);
    setText("task-title", copy.title);
    setText("task-instruction", state.step === "recall" ? lesson.recallCue : copy.instruction);
    const visiblePhrase = state.step === "recall"
      ? "Phrase hidden · Say it from memory"
      : state.step === "use"
        ? `Try to use: “${lesson.target}”`
        : lesson.target;
    setText("target-phrase", visiblePhrase);
    setText("translation", lesson.translation);
    renderChunks(lesson.chunks);
    setText("primary-action", copy.primary);
    $("primary-action").innerHTML = `<span>${copy.primary}</span><i aria-hidden="true">→</i>`;
    setText("secondary-action", copy.secondary);
    setText("action-help", copy.help);
    resetCaptureUI();
    $("type-instead").hidden = ["listen", "repeat"].includes(state.step);

    if (state.step === "fix") {
      $("task-note").hidden = false;
      setText("task-note-label", "One thing to fix");
      setText("task-note-title", lesson.fixTitle);
      setText("task-note-copy", lesson.fixCopy);
    }
    if (state.step === "use") {
      setText("task-instruction", `Coach asks: ${lesson.useQuestion}`);
    }
    updateStepper();

    if (announce) {
      if (state.step === "listen") speakCoach(lesson.target);
      if (state.step === "fix") speakCoach(lesson.fixChunk);
      if (state.step === "use") speakCoach(lesson.useQuestion);
    }
  }

  function updateAfterCapture(text) {
    state.stepComplete = true;
    $("capture-result").hidden = false;
    setText("capture-label", state.step === "use" ? "Your answer" : "I heard");
    setText("capture-text", text);
    $("text-entry").hidden = true;
    $("type-instead").hidden = true;
    $("primary-action").hidden = false;
    $("secondary-action").hidden = false;
    $("play-recording").hidden = !state.currentAudioUrl;

    const nextLabels = {
      repeat: "See what to fix",
      fix: "Now say it from memory",
      recall: "Use it in conversation",
      use: state.sentenceIndex < LESSON.length - 1 ? "Next sentence" : "Finish lesson"
    };
    const label = nextLabels[state.step] || "Continue";
    $("primary-action").innerHTML = `<span>${label}</span><i aria-hidden="true">→</i>`;
    setText("action-help", state.step === "use" ? "Done — you used the phrase in a real answer." : "Got it. Continue to make the phrase stick.");

    if (state.step === "repeat") {
      const missing = findMissingChunk(text, currentLesson().chunks);
      $("task-note").hidden = false;
      setText("task-note-label", missing ? "Practice this next" : "Tune one detail next");
      setText("task-note-title", missing ? `Practice again: ${missing}` : currentLesson().fixTitle);
      setText("task-note-copy", missing ? "The transcript did not capture this whole thought group. No score yet — say this part clearly in the next step." : currentLesson().fixCopy);
    }
  }

  function normalizedWords(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
  }

  function findMissingChunk(text, chunks) {
    const heard = new Set(normalizedWords(text));
    return chunks.find(chunk => normalizedWords(chunk).some(word => !heard.has(word))) || "";
  }

  function finishCapturedText(rawText) {
    const text = String(rawText || "").trim().replace(/\s+/g, " ");
    if (!text) {
      showTextEntry("I did not catch that attempt. Try again, or type what you said.");
      return;
    }
    state.records[state.sentenceIndex][state.step] = {
      text,
      at: Date.now(),
      audioUrl: state.currentAudioUrl || ""
    };
    updateAfterCapture(text);
  }

  function showTextEntry(message = "If you cannot use the microphone, type your English answer and continue the same lesson.") {
    $("text-entry").hidden = false;
    $("capture-result").hidden = true;
    $("type-instead").hidden = true;
    $("primary-action").hidden = true;
    $("secondary-action").hidden = true;
    setText("action-help", message);
    setTimeout(() => $("typed-answer").focus(), 0);
  }

  function getRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    return recognition;
  }

  async function beginCapture() {
    if (state.recording) return;
    state.stepComplete = false;
    state.transcript = "";
    state.audioChunks = [];
    $("capture-result").hidden = true;
    $("text-entry").hidden = true;

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      showTextEntry("The microphone is unavailable. Allow microphone access, or type your English answer.");
      return;
    }

    state.mediaStream = stream;
    state.recording = true;
    $("recording-toast").hidden = false;
    setText("recording-hint", state.step === "use" ? "Press “Done” after your full answer" : "Pause when you finish, or press “Done”");
    setCoachVisual("listening", "Your turn · Listening");
    setText("caption-speaker", "You");
    setText("caption-text", "Start speaking. I’ll show the words I hear.");

    if (window.MediaRecorder) {
      try {
        const recorder = new MediaRecorder(stream);
        state.mediaRecorder = recorder;
        recorder.ondataavailable = event => { if (event.data?.size) state.audioChunks.push(event.data); };
        recorder.onstop = () => {
          if (!state.audioChunks.length) return;
          const blob = new Blob(state.audioChunks, { type: recorder.mimeType || "audio/webm" });
          if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
          state.currentAudioUrl = URL.createObjectURL(blob);
          $("play-recording").hidden = $("capture-result").hidden;
          const record = state.records[state.sentenceIndex]?.[state.step];
          if (record) record.audioUrl = state.currentAudioUrl;
        };
        recorder.start();
      } catch {
        state.mediaRecorder = null;
      }
    }

    const recognition = getRecognition();
    state.recognition = recognition;
    if (!recognition) {
      setText("recording-hint", "Recording — press “Done,” then confirm the transcript");
      return;
    }

    let finalText = "";
    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += `${chunk} `;
        else interim += chunk;
      }
      state.transcript = `${finalText}${interim}`.trim();
      setText("caption-text", state.transcript || "Listening…");
      clearTimeout(state.silenceTimer);
      if (finalText.trim()) state.silenceTimer = setTimeout(() => stopCapture(), 1500);
    };
    recognition.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopCapture({ showFallback: true });
      }
    };
    recognition.onend = () => {
      if (state.recording && state.transcript) stopCapture();
    };
    try { recognition.start(); }
    catch { setText("recording-hint", "Recording — press “Done,” then confirm the transcript"); }
  }

  function stopCapture({ showFallback = false } = {}) {
    if (!state.recording) {
      if (showFallback) showTextEntry();
      return;
    }
    state.recording = false;
    clearTimeout(state.silenceTimer);
    state.silenceTimer = null;
    $("recording-toast").hidden = true;
    try { state.recognition?.stop(); } catch {}
    state.recognition = null;
    try {
      if (state.mediaRecorder?.state !== "inactive") state.mediaRecorder?.stop();
    } catch {}
    state.mediaRecorder = null;
    state.mediaStream?.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
    restoreCoachState();
    if (showFallback || !state.transcript.trim()) showTextEntry();
    else finishCapturedText(state.transcript);
  }

  async function speakCoach(text) {
    const phrase = String(text || "").trim();
    if (!phrase) return;
    state.pendingCoachText = phrase;
    setText("caption-speaker", "Coach");
    setText("caption-text", phrase);
    setCoachVisual("speaking", "Coach is speaking");

    if (state.baseMode === "tavus-live" && state.call && state.conversationId) {
      try {
        await state.call.sendAppMessage({
          message_type: "conversation",
          event_type: "conversation.echo",
          conversation_id: state.conversationId,
          properties: { modality: "text", text: phrase, done: true }
        }, "*");
        clearTimeout(state.coachRestoreTimer);
        state.coachRestoreTimer = setTimeout(restoreCoachState, Math.max(5000, phrase.split(/\s+/).length * 520 + 2500));
        return;
      } catch {
        state.baseMode = "audio";
      }
    }

    showConnectionFailure("Connect to the live Tavus video coach before asking for a model.");
  }

  function normalizeRole(role) {
    const value = String(role || "").toLowerCase();
    if (["pal", "replica", "assistant", "agent"].includes(value)) return "coach";
    if (["user", "participant", "human"].includes(value)) return "user";
    return value;
  }

  function handleTavusMessage(event) {
    const message = event?.data || event;
    if (!message || typeof message !== "object") return;
    if (message.conversation_id && message.conversation_id !== state.conversationId) return;
    const role = normalizeRole(message.properties?.role);
    const speech = message.properties?.speech || message.properties?.text || message.properties?.transcript || "";

    if (message.event_type === "conversation.started_speaking") {
      if (role === "coach") setCoachVisual("speaking", "Coach is speaking");
      return;
    }
    if (message.event_type === "conversation.stopped_speaking") {
      clearTimeout(state.coachRestoreTimer);
      restoreCoachState();
      return;
    }
    if (message.event_type !== "conversation.utterance" || !speech) return;

    if (role === "coach") {
      setText("caption-speaker", "Coach");
      setText("caption-text", speech);
      return;
    }
    if (role === "user") {
      setText("caption-speaker", "You");
      setText("caption-text", speech);
      if (state.recording) {
        state.transcript = speech;
        clearTimeout(state.silenceTimer);
        state.silenceTimer = setTimeout(() => stopCapture(), 350);
      }
    }
  }

  function attachRemoteMedia(participant) {
    if (!participant || participant.local) return false;
    const videoTrack = participant.tracks?.video?.persistentTrack || participant.videoTrack || null;
    const audioTrack = participant.tracks?.audio?.persistentTrack || participant.audioTrack || null;
    const videoReady = participant.tracks?.video?.state === "playable" || Boolean(videoTrack);
    if (!videoReady || !videoTrack) return false;

    const tracks = [videoTrack, audioTrack].filter(Boolean);
    const stream = new MediaStream(tracks);
    const player = $("tavus-video");
    player.srcObject = stream;
    player.muted = false;
    player.play().catch(() => {
      player.muted = true;
      player.play().catch(() => {});
      setText("caption-speaker", "Tavus");
      setText("caption-text", "Video connected. Your browser blocked autoplay with sound; click the video to continue.");
    });
    return true;
  }

  async function connectTavus() {
    if (state.baseMode === "tavus-live" && state.call) return true;
    if (state.connecting) return state.connecting;
    state.connecting = (async () => {
      $("connection-card").hidden = true;
      setCoachVisual("connecting", "Inviting your video coach");
      setText("preview-ribbon", "CONNECTING TO TAVUS…");
      try {
        if (!window.Daily) throw new Error("Daily video client did not load.");
        const room = await fetchJSON("/api/tavus/conversations", {
          method: "POST",
          body: JSON.stringify({ topic: "Tavus interview English", focus: "language_lesson" })
        });
        state.conversationId = room.conversation_id;
        const call = window.Daily.createCallObject({
          audioSource: false,
          videoSource: false,
          subscribeToTracksAutomatically: true
        });
        state.call = call;
        call.on("app-message", handleTavusMessage);
        call.on("error", () => { void failConnection("The video connection failed. Your lesson progress is saved."); });
        call.on("left-meeting", () => {
          if (document.body.dataset.view === "lesson") void failConnection("The video connection ended. Your progress is saved; reconnect to continue.");
        });

        let acceptRemote;
        const remoteJoined = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The Tavus video track did not become playable in time.")), 25000);
          acceptRemote = participant => {
            if (!attachRemoteMedia(participant)) return;
            clearTimeout(timer);
            resolve(true);
          };
        });
        call.on("participant-joined", event => acceptRemote(event?.participant));
        call.on("participant-updated", event => acceptRemote(event?.participant));
        call.on("participant-left", event => {
          if (event?.participant && !event.participant.local) void failConnection("The Tavus video coach left the room. Reconnect to continue.");
        });

        $("daily-stage").hidden = false;
        $("daily-stage").classList.add("pending");
        await call.join({
          url: room.conversation_url,
          token: room.meeting_token,
          userName: "Fluent Me learner",
          startVideoOff: true,
          startAudioOff: true
        });
        Object.values(call.participants?.() || {}).forEach(acceptRemote);
        await remoteJoined;

        state.baseMode = "tavus-live";
        $("daily-stage").classList.remove("pending");
        $("coach-still").hidden = true;
        $("preview-ribbon").hidden = true;
        setCoachVisual("tavus-live", "Live Tavus video coach connected");
        return true;
      } catch (error) {
        await failConnection(error.message || "The video coach did not join.");
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
    $("preview-ribbon").hidden = false;
    setText("preview-ribbon", "WAITING FOR LIVE TAVUS VIDEO");
    setCoachVisual("unavailable", "Video coach is not connected");
    $("connection-card").hidden = false;
    setText("connection-copy", detail || "This is not preview mode. Reconnect to the live Tavus coach.");
  }

  async function failConnection(detail) {
    if (state.failureInProgress) return;
    state.failureInProgress = true;
    try {
      await destroyCall(true);
      state.baseMode = "offline";
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
    const player = $("tavus-video");
    if (player) {
      player.pause();
      player.srcObject = null;
    }
    if (call) {
      try { await call.leave(); } catch {}
      try { await call.destroy(); } catch {}
    }
    if (endRemote && conversationId) {
      try {
        await fetchJSON(`/api/tavus/conversations/${encodeURIComponent(conversationId)}/end`, { method: "POST", body: "{}" });
      } catch {}
    }
  }

  async function startLesson() {
    state.sentenceIndex = 0;
    state.step = "listen";
    state.records = LESSON.map(() => ({}));
    setView("lesson");
    renderStep();
    if (state.configured) {
      await connectTavus();
    } else {
      showConnectionFailure("This deployment does not have a valid Tavus server credential, so it cannot create a live video room.");
    }
  }

  function advanceAfterCapture() {
    if (state.step === "repeat") state.step = "fix";
    else if (state.step === "fix") state.step = "recall";
    else if (state.step === "recall") state.step = "use";
    else if (state.step === "use") {
      if (state.sentenceIndex >= LESSON.length - 1) {
        completeLesson();
        return;
      }
      state.sentenceIndex += 1;
      state.step = "listen";
    }
    renderStep({ announce: state.step === "fix" || state.step === "use" || state.step === "listen" });
  }

  function handlePrimary() {
    if (state.step === "listen") {
      state.step = "repeat";
      renderStep();
      return;
    }
    if (state.stepComplete) {
      advanceAfterCapture();
      return;
    }
    beginCapture();
  }

  function handleSecondary() {
    const lesson = currentLesson();
    if (state.step === "listen") speakCoach(lesson.target);
    else if (state.step === "repeat") showTextEntry();
    else if (state.step === "fix") speakCoach(lesson.fixChunk);
    else if (state.step === "recall") {
      $("task-note").hidden = false;
      setText("task-note-label", "A small hint");
      setText("task-note-title", lesson.chunks[0]);
      setText("task-note-copy", "Use only the opening words, then retrieve the rest from memory.");
    } else if (state.step === "use") speakCoach(lesson.useQuestion);
  }

  async function completeLesson() {
    stopCapture();
    const completedAt = new Date().toISOString();
    const review = {
      completedAt,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      phrases: LESSON.map((lesson, index) => ({
        target: lesson.target,
        translation: lesson.translation,
        recall: state.records[index].recall?.text || "",
        use: state.records[index].use?.text || ""
      }))
    };
    try { localStorage.setItem("fluent-me:latest-lesson", JSON.stringify(review)); } catch {}

    const root = $("learned-list");
    root.replaceChildren();
    review.phrases.forEach((phrase, index) => {
      const card = document.createElement("article");
      card.className = "learned-item";
      const number = document.createElement("span");
      number.textContent = `0${index + 1} · LEARNED`;
      const target = document.createElement("p");
      target.textContent = phrase.target;
      const detail = document.createElement("small");
      detail.textContent = phrase.use ? `You said in conversation: ${phrase.use}` : phrase.translation;
      card.append(number, target, detail);
      root.appendChild(card);
    });
    setView("complete");
    window.speechSynthesis?.cancel();
    await destroyCall(true);
  }

  async function exitLesson() {
    stopCapture();
    window.speechSynthesis?.cancel();
    await destroyCall(true);
    state.baseMode = "offline";
    $("daily-stage").hidden = true;
    $("coach-still").hidden = false;
    $("preview-ribbon").hidden = false;
    $("connection-card").hidden = true;
    setView("welcome");
    checkCapability();
  }

  $("start-lesson").addEventListener("click", startLesson);
  $("primary-action").addEventListener("click", handlePrimary);
  $("secondary-action").addEventListener("click", handleSecondary);
  $("type-instead").addEventListener("click", () => showTextEntry("Type your English answer to continue the full lesson."));
  $("stop-recording").addEventListener("click", () => stopCapture());
  $("submit-text").addEventListener("click", () => finishCapturedText($("typed-answer").value));
  $("edit-transcript").addEventListener("click", () => {
    $("typed-answer").value = $("capture-text").textContent || "";
    showTextEntry("Edit the transcript, then press “Use this answer.”");
  });
  $("play-recording").addEventListener("click", () => {
    if (!state.currentAudioUrl) return;
    window.speechSynthesis?.cancel();
    new Audio(state.currentAudioUrl).play().catch(() => {});
  });
  $("retry-tavus").addEventListener("click", async () => {
    $("connection-card").hidden = true;
    const connected = await connectTavus();
    if (connected) {
      const lesson = currentLesson();
      if (state.step === "fix") speakCoach(lesson.fixChunk);
      else if (state.step === "use") speakCoach(lesson.useQuestion);
    }
  });
  $("exit-button").addEventListener("click", exitLesson);
  $("practice-again").addEventListener("click", startLesson);
  $("back-home").addEventListener("click", () => { setView("welcome"); checkCapability(); });

  window.addEventListener("beforeunload", () => {
    state.mediaStream?.getTracks().forEach(track => track.stop());
    if (state.conversationId) {
      fetch(`/api/tavus/conversations/${encodeURIComponent(state.conversationId)}/end`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true
      }).catch(() => {});
    }
  });

  if (window.speechSynthesis) window.speechSynthesis.getVoices();
  checkCapability();
})();
