(() => {
  "use strict";

  const LESSON = [
    {
      target: "Tavus is more than a digital face.",
      translation: "Tavus 不只是一个数字人脸。",
      chunks: ["Tavus is more than", "a digital face"],
      fixChunk: "more than a digital face",
      fixTitle: "把这一段连成一个意群",
      fixCopy: "不要在 more 和 than 中间停顿。先听教练说这一小段，再一口气跟上。",
      recallCue: "请用英文表达：Tavus 不只是一个数字人脸。",
      useQuestion: "If Tavus is more than a digital face, what is the real product?"
    },
    {
      target: "The face is the interface; the real product is the system behind it.",
      translation: "人脸是交互界面，真正的产品是它背后的系统。",
      chunks: ["The face is the interface", "the real product", "is the system behind it"],
      fixChunk: "the system behind it",
      fixTitle: "把重音放在 system 上",
      fixCopy: "face 是表层，system 才是对比重点。让 system 比前后的词更清楚。",
      recallCue: "请用英文表达：人脸是界面，真正的产品是背后的系统。",
      useQuestion: "What do you mean by the system behind the face?"
    },
    {
      target: "It combines perception, memory, and orchestration to make conversations feel responsive.",
      translation: "它把感知、记忆和编排结合起来，让对话真正有响应感。",
      chunks: ["It combines perception", "memory and orchestration", "to make conversations feel responsive"],
      fixChunk: "perception, memory, and orchestration",
      fixTitle: "三个能力要有清楚的节奏",
      fixCopy: "把 perception、memory、orchestration 当成三个并列拍点，不要挤成一团。",
      recallCue: "请用英文表达：它结合感知、记忆和编排，让对话更有响应感。",
      useQuestion: "How do perception, memory, and orchestration change the user experience?"
    }
  ];

  const STEPS = ["listen", "repeat", "fix", "recall", "use"];
  const STEP_COPY = {
    listen: {
      index: "第 1 / 5 步 · LISTEN",
      title: "先听教练说，不用开口。",
      instruction: "看着教练，注意句子里的自然意群。",
      primary: "轮到我",
      secondary: "再听一遍",
      help: "听清楚以后，点击“轮到我”。"
    },
    repeat: {
      index: "第 2 / 5 步 · REPEAT",
      title: "照着读一遍，不必完美。",
      instruction: "保留句子的节奏，先把完整意思说出来。",
      primary: "开始跟读",
      secondary: "改为输入",
      help: "点击后开始说；说完停顿，或点“完成”。"
    },
    fix: {
      index: "第 3 / 5 步 · FIX ONE THING",
      title: "只练这一小段。",
      instruction: "一次只改一个动作，比看一排分数更有用。",
      primary: "练这一小段",
      secondary: "听这一小段",
      help: "听一次，再照着教练的节奏说。"
    },
    recall: {
      index: "第 4 / 5 步 · RECALL",
      title: "现在不看英文，说出同样意思。",
      instruction: "不必逐字一样；重点是从记忆里把表达找回来。",
      primary: "开始脱稿说",
      secondary: "给我一个提示",
      help: "英文会被藏起来，只保留中文意思。"
    },
    use: {
      index: "第 5 / 5 步 · USE",
      title: "把刚学的表达用进回答。",
      instruction: "教练会问一个真实问题。用自己的内容回答，不要背句子。",
      primary: "回答教练",
      secondary: "再听问题",
      help: "尽量用到刚学的表达；答案可以自由发挥。"
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
      setCoachVisual("tavus-live", "Tavus 视频教练已连接");
    } else {
      setCoachVisual("offline", "等待 Tavus 视频教练");
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
        setWelcomeStatus("tavus-ready", "Tavus 已配置，开始时尝试连接", "远端教练真正加入后，页面才会显示“实时已连接”");
      } else if (status.has_key) {
        setWelcomeStatus("unavailable", "Tavus 密钥验证失败", status.error || "请轮换服务端密钥后再连接");
      } else {
        setWelcomeStatus("offline", "真实 Tavus 尚未配置", "配置完成前不会用静态人脸冒充视频教练");
      }
    } catch {
      state.configured = false;
      setWelcomeStatus("unavailable", "暂时无法检查 Tavus", "课程仍可使用本机语音完成");
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
    setText("sentence-count", `第 ${state.sentenceIndex + 1} / ${LESSON.length} 句`);
    setText("task-index", copy.index);
    setText("task-title", copy.title);
    setText("task-instruction", state.step === "recall" ? lesson.recallCue : copy.instruction);
    const visiblePhrase = state.step === "recall"
      ? "英文已隐藏 · Say it from memory"
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
      setText("task-note-label", "只改这一处");
      setText("task-note-title", lesson.fixTitle);
      setText("task-note-copy", lesson.fixCopy);
    }
    if (state.step === "use") {
      setText("task-instruction", `教练问：${lesson.useQuestion}`);
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
    setText("capture-label", state.step === "use" ? "你的回答" : "我听到你说");
    setText("capture-text", text);
    $("text-entry").hidden = true;
    $("type-instead").hidden = true;
    $("primary-action").hidden = false;
    $("secondary-action").hidden = false;
    $("play-recording").hidden = !state.currentAudioUrl;

    const nextLabels = {
      repeat: "看这一处怎么改",
      fix: "现在脱稿说",
      recall: "放进对话里",
      use: state.sentenceIndex < LESSON.length - 1 ? "下一句" : "完成课程"
    };
    const label = nextLabels[state.step] || "继续";
    $("primary-action").innerHTML = `<span>${label}</span><i aria-hidden="true">→</i>`;
    setText("action-help", state.step === "use" ? "完成了：你已经把这句话放进真实回答。" : "听到了。继续下一步，把刚才的表达留下来。");

    if (state.step === "repeat") {
      const missing = findMissingChunk(text, currentLesson().chunks);
      $("task-note").hidden = false;
      setText("task-note-label", missing ? "下一步会补上这一段" : "下一步只调一个细节");
      setText("task-note-title", missing ? `再练：${missing}` : currentLesson().fixTitle);
      setText("task-note-copy", missing ? "转写里没有完整识别到这个意群。先不打分，下一步把它单独说清楚。" : currentLesson().fixCopy);
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
      showTextEntry("没有听清这一遍。你可以再说一次，或输入你刚才说的句子。");
      return;
    }
    state.records[state.sentenceIndex][state.step] = {
      text,
      at: Date.now(),
      audioUrl: state.currentAudioUrl || ""
    };
    updateAfterCapture(text);
  }

  function showTextEntry(message = "不方便开麦也没关系。输入你想说的英文，继续同一套练习。") {
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
      showTextEntry("无法使用麦克风。请允许麦克风权限，或直接输入你想说的英文。");
      return;
    }

    state.mediaStream = stream;
    state.recording = true;
    $("recording-toast").hidden = false;
    setText("recording-hint", state.step === "use" ? "回答完整后点“完成”" : "说完后停顿，或点“完成”");
    setCoachVisual("listening", "轮到你 · 正在听");
    setText("caption-speaker", "你");
    setText("caption-text", "开始说吧，我会把听到的词显示出来。");

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
      setText("recording-hint", "录音中；完成后请确认文字");
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
      setText("caption-text", state.transcript || "正在听…");
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
    catch { setText("recording-hint", "录音中；完成后请确认文字"); }
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
    setText("caption-speaker", "教练");
    setText("caption-text", phrase);
    setCoachVisual("speaking", "教练正在说");

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

    showConnectionFailure("需要先连接真实 Tavus 视频，教练才会示范这句话。");
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
      if (role === "coach") setCoachVisual("speaking", "教练正在说");
      return;
    }
    if (message.event_type === "conversation.stopped_speaking") {
      clearTimeout(state.coachRestoreTimer);
      restoreCoachState();
      return;
    }
    if (message.event_type !== "conversation.utterance" || !speech) return;

    if (role === "coach") {
      setText("caption-speaker", "教练");
      setText("caption-text", speech);
      return;
    }
    if (role === "user") {
      setText("caption-speaker", "你");
      setText("caption-text", speech);
      if (state.recording) {
        state.transcript = speech;
        clearTimeout(state.silenceTimer);
        state.silenceTimer = setTimeout(() => stopCapture(), 350);
      }
    }
  }

  async function connectTavus() {
    if (state.baseMode === "tavus-live" && state.call) return true;
    if (state.connecting) return state.connecting;
    state.connecting = (async () => {
      $("connection-card").hidden = true;
      setCoachVisual("connecting", "正在请视频教练加入");
      setText("preview-ribbon", "CONNECTING TO TAVUS…");
      try {
        if (!window.Daily) throw new Error("Daily video client did not load.");
        const room = await fetchJSON("/api/tavus/conversations", {
          method: "POST",
          body: JSON.stringify({ topic: "Tavus interview English", focus: "language_lesson" })
        });
        state.conversationId = room.conversation_id;
        const call = window.Daily.createFrame($("daily-stage"), {
          showLeaveButton: false,
          showFullscreenButton: false,
          showLocalVideo: true,
          iframeStyle: { width: "100%", height: "100%", border: "0" }
        });
        state.call = call;
        call.on("app-message", handleTavusMessage);
        call.on("error", () => { void failConnection("视频连接发生错误。学习进度已经保留。"); });
        call.on("left-meeting", () => {
          if (document.body.dataset.view === "lesson") void failConnection("视频连接已经结束。学习进度还在，你可以重连或继续语音练习。");
        });

        const remoteJoined = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The coach did not join in time.")), 20000);
          const accept = participant => {
            const videoReady = participant?.video || participant?.tracks?.video?.state === "playable";
            if (participant && !participant.local && videoReady) {
              clearTimeout(timer);
              resolve(true);
            }
          };
          call.on("participant-joined", event => accept(event?.participant));
          call.on("participant-updated", event => accept(event?.participant));
        });

        $("daily-stage").hidden = false;
        $("daily-stage").classList.add("pending");
        await call.join({
          url: room.conversation_url,
          token: room.meeting_token,
          startVideoOff: true,
          startAudioOff: true
        });
        await remoteJoined;

        state.baseMode = "tavus-live";
        $("daily-stage").classList.remove("pending");
        $("coach-still").hidden = true;
        $("preview-ribbon").hidden = true;
        setCoachVisual("tavus-live", "Tavus 视频教练已连接");
        return true;
      } catch (error) {
        await failConnection(error.message || "视频教练暂时没有加入。");
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
    setText("preview-ribbon", "等待真实 TAVUS 视频");
    setCoachVisual("unavailable", "视频教练暂未连接");
    $("connection-card").hidden = false;
    setText("connection-copy", detail || "这不是预览模式。请重新连接真实 Tavus 视频教练。");
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
      showConnectionFailure("这个部署还没有可用的 Tavus 服务端密钥，无法创建真实视频房间。");
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
      setText("task-note-label", "一个小提示");
      setText("task-note-title", lesson.chunks[0]);
      setText("task-note-copy", "只看开头，剩下的自己从记忆里找回来。");
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
      detail.textContent = phrase.use ? `你在对话里说：${phrase.use}` : phrase.translation;
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
  $("type-instead").addEventListener("click", () => showTextEntry("直接输入你想说的英文，也可以走完整个练习。"));
  $("stop-recording").addEventListener("click", () => stopCapture());
  $("submit-text").addEventListener("click", () => finishCapturedText($("typed-answer").value));
  $("edit-transcript").addEventListener("click", () => {
    $("typed-answer").value = $("capture-text").textContent || "";
    showTextEntry("修改后点击“使用这句话”。");
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
