(() => {
  "use strict";

  const PROFILE_KEY = "fluentMePersonalCoachV1";
  const FACE_SECONDS = 60;
  const VOICE_MIN_SECONDS = 30;
  const VOICE_RECOMMENDED_SECONDS = 60;
  const VOICE_MAX_SECONDS = 90;
  const FACE_POLL_MS = 30_000;
  const $ = id => document.getElementById(id);
  const dialog = $("personalization-dialog");
  if (!dialog) return;

  const cameraStage = $("setup-camera-preview").closest(".setup-camera-stage");
  const voiceStage = $("voice-record-button").closest(".voice-sample-card");
  const emptyProfile = () => ({ face_id: "", voice_id: "", pal_id: "" });
  const state = {
    profile: loadProfile(),
    faceStream: null,
    faceRecorder: null,
    faceChunks: [],
    faceBlob: null,
    faceUrl: "",
    faceStartedAt: 0,
    faceTimer: null,
    voiceStream: null,
    voiceRecorder: null,
    voiceChunks: [],
    voiceBlob: null,
    voiceUrl: "",
    voiceStartedAt: 0,
    voiceSeconds: 0,
    voiceTimer: null,
    facePoll: null,
    faceSubmitting: false,
    voiceSubmitting: false,
    palSubmitting: false,
    pendingFaceId: "",
    captureGeneration: 0,
    facePollGeneration: 0,
    pendingVoiceId: "",
    voiceVerificationRequired: false,
    captureStarting: false,
    actionGeneration: 0,
  };

  function loadProfile() {
    try {
      const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      return {
        face_id: safeId(value.face_id),
        voice_id: safeId(value.voice_id),
        pal_id: safeId(value.pal_id),
      };
    } catch {
      return emptyProfile();
    }
  }

  function safeId(value) {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9_-]{3,128}$/.test(text) ? text : "";
  }

  function saveProfile(next) {
    state.profile = {
      face_id: safeId(next.face_id),
      voice_id: safeId(next.voice_id),
      pal_id: safeId(next.pal_id),
    };
    if (state.profile.face_id || state.profile.voice_id || state.profile.pal_id) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    } else {
      localStorage.removeItem(PROFILE_KEY);
    }
    window.dispatchEvent(new CustomEvent("fluentme:personalization-change", {
      detail: { ...state.profile },
    }));
    renderProfile();
  }

  async function fetchJSON(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) headers["content-type"] = "application/json";
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "That request could not be completed.");
    return payload;
  }

  function formatClock(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function setProgress(id, mode, message) {
    const node = $(id);
    node.dataset.state = mode;
    const target = node.querySelector("span") || node;
    target.textContent = message;
  }

  function stopTracks(stream) {
    stream?.getTracks?.().forEach(track => track.stop());
  }

  function clearTimer(kind) {
    clearInterval(state[`${kind}Timer`]);
    state[`${kind}Timer`] = null;
  }

  function revokeUrl(kind) {
    const key = `${kind}Url`;
    if (state[key]) URL.revokeObjectURL(state[key]);
    state[key] = "";
  }

  function recorderOptions() {
    if (!window.MediaRecorder) return {};
    for (const mimeType of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
      if (MediaRecorder.isTypeSupported?.(mimeType)) return { mimeType };
    }
    return {};
  }

  function audioRecorderOptions() {
    if (!window.MediaRecorder) return {};
    for (const mimeType of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported?.(mimeType)) return { mimeType };
    }
    return {};
  }

  function consentReady() {
    return $("consent-checkbox").checked && $("clone-full-name").value.trim().length >= 2;
  }

  function updateConsentScript() {
    const name = $("clone-full-name").value.trim() || "[FULL NAME]";
    $("consent-script").textContent = `“I, ${name}, am currently speaking and give consent to Tavus to create an AI clone of me by using the audio and video samples I provide. I understand that this AI clone can be used to create videos that look and sound like me.”`;
    updateButtons();
  }

  function updateButtons() {
    const allowed = consentReady();
    const recording = Boolean(state.captureStarting || state.faceRecorder || state.voiceRecorder);
    $("setup-record-button").disabled = !allowed || recording;
    $("voice-record-button").disabled = !allowed || recording;
    $("clone-voice-button").disabled = !allowed || recording || !state.voiceBlob || state.voiceSeconds < VOICE_MIN_SECONDS || state.voiceSubmitting || state.palSubmitting;
    $("create-face-button").disabled = !allowed || recording || !$("training-url").value.trim() || state.faceSubmitting;
    $("use-personal-coach").disabled = recording || state.faceSubmitting || state.voiceSubmitting || state.palSubmitting || !(state.profile.face_id || state.profile.pal_id);
  }

  function renderProfile() {
    const face = Boolean(state.profile.face_id);
    const voice = Boolean(state.profile.voice_id);
    const pal = Boolean(state.profile.pal_id);
    const label = face && voice && pal
      ? "Your face + voice ready"
      : pal
        ? "Your voice + stock face ready"
        : face
          ? "Your face + stock voice ready"
          : "Stock coach active";
    $("personalization-status").textContent = label;
    if (voice) setProgress("voice-clone-status", "ready", "Your personal voice is ready.");
    if (face) setProgress("face-training-status", "ready", "Your personal Face is trained and ready.");
    updateButtons();
  }

  async function loadProviderStatus() {
    $("eleven-plan").textContent = "Checking…";
    $("eleven-usage").textContent = "Checking…";
    try {
      const status = await fetchJSON("/api/personalization/status");
      const eleven = status.elevenlabs || {};
      if (!status.tavus?.configured) {
        setProgress("face-training-status", "error", "Add TAVUS_API_KEY before submitting Face training.");
      }
      if (!eleven.configured) {
        $("eleven-plan").textContent = "API key needed";
        $("eleven-usage").textContent = "Grant not verified";
        setProgress("voice-clone-status", "error", "Add ELEVENLABS_API_KEY after accepting your grant or enabling an IVC plan.");
        return;
      }
      const tier = String(eleven.tier || "Configured");
      const ivc = eleven.can_use_instant_voice_cloning;
      $("eleven-plan").textContent = ivc === false ? `${tier} · IVC unavailable` : `${tier} · IVC ${ivc === true ? "ready" : "unknown"}`;
      const used = Number(eleven.character_count);
      const limit = Number(eleven.character_limit);
      $("eleven-usage").textContent = Number.isFinite(used) && Number.isFinite(limit) && limit > 0
        ? `${used.toLocaleString()} / ${limit.toLocaleString()}`
        : "Unavailable";
      if (eleven.error) setProgress("voice-clone-status", "error", eleven.error);
    } catch (error) {
      $("eleven-plan").textContent = "Unavailable";
      $("eleven-usage").textContent = "Unavailable";
      setProgress("voice-clone-status", "error", error.message);
    }
  }

  async function startFaceRecording() {
    if (!consentReady() || state.captureStarting || state.faceRecorder || state.voiceRecorder) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setProgress("face-training-status", "error", "This browser cannot record camera training video.");
      return;
    }
    const generation = state.captureGeneration;
    state.captureStarting = true;
    updateButtons();
    try {
      stopTracks(state.faceStream);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, min: 25 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (generation !== state.captureGeneration || !dialog.open) {
        stopTracks(stream);
        return;
      }
      state.faceStream = stream;
      const settings = state.faceStream.getVideoTracks()[0]?.getSettings?.() || {};
      const belowTarget = (settings.width && settings.width < 1920)
        || (settings.height && settings.height < 1080)
        || (settings.frameRate && settings.frameRate < 25);
      $("setup-camera-preview").srcObject = state.faceStream;
      await $("setup-camera-preview").play();
      revokeUrl("face");
      state.faceBlob = null;
      state.faceChunks = [];
      state.faceRecorder = new MediaRecorder(state.faceStream, recorderOptions());
      state.faceRecorder.ondataavailable = event => { if (event.data?.size) state.faceChunks.push(event.data); };
      state.faceRecorder.onstop = () => finishFaceRecording(generation);
      state.faceRecorder.start(1000);
      state.faceStartedAt = Date.now();
      cameraStage.dataset.state = "recording";
      $("setup-stop-button").disabled = false;
      $("setup-record-button").disabled = true;
      $("setup-recording-guide").querySelectorAll("li").forEach((node, index) => node.classList.toggle("active", index === 0));
      $("setup-audio-status").textContent = belowTarget
        ? `Your camera reported ${settings.width || "?"}×${settings.height || "?"} at ${Math.round(settings.frameRate || 0) || "?"} fps. Use PAL Maker or a desktop recorder for reliable training quality.`
        : "Recording locally. Read the consent phrase first.";
      const tick = () => {
        const elapsed = Math.min(FACE_SECONDS, (Date.now() - state.faceStartedAt) / 1000);
        $("setup-timer").textContent = `${formatClock(elapsed)} / 01:00`;
        const index = elapsed < 8 ? 0 : elapsed < 30 ? 1 : 2;
        $("setup-recording-guide").querySelectorAll("li").forEach((node, item) => node.classList.toggle("active", item === index));
        if (elapsed >= FACE_SECONDS) stopFaceRecording();
      };
      tick();
      state.faceTimer = setInterval(tick, 250);
    } catch (error) {
      stopTracks(state.faceStream);
      state.faceStream = null;
      cameraStage.dataset.state = "idle";
      $("setup-audio-status").textContent = error.name === "NotAllowedError"
        ? "Camera or microphone permission was not granted."
        : `Recording could not start: ${error.message}`;
    } finally {
      state.captureStarting = false;
      updateButtons();
    }
  }

  function stopFaceRecording() {
    if (state.faceRecorder && state.faceRecorder.state !== "inactive") state.faceRecorder.stop();
  }

  function finishFaceRecording(generation) {
    clearTimer("face");
    const recorder = state.faceRecorder;
    state.faceRecorder = null;
    stopTracks(state.faceStream);
    state.faceStream = null;
    $("setup-camera-preview").srcObject = null;
    cameraStage.dataset.state = "idle";
    $("setup-stop-button").disabled = true;
    $("setup-recording-guide").querySelectorAll("li").forEach(node => node.classList.remove("active"));
    if (generation !== state.captureGeneration) {
      state.faceChunks = [];
      updateButtons();
      return;
    }
    if (state.faceChunks.length) {
      state.faceBlob = new Blob(state.faceChunks, { type: recorder?.mimeType || "video/webm" });
      revokeUrl("face");
      state.faceUrl = URL.createObjectURL(state.faceBlob);
      $("setup-recording-playback").src = state.faceUrl;
      $("setup-recording-playback").hidden = false;
      $("setup-download-video").href = state.faceUrl;
      $("setup-download-video").hidden = false;
      $("setup-audio-status").textContent = "Saved only in this tab. Review it, then download it if you want to submit through your own storage.";
    }
    updateButtons();
  }

  async function startVoiceRecording() {
    if (!consentReady() || state.captureStarting || state.faceRecorder || state.voiceRecorder) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setProgress("voice-clone-status", "error", "This browser cannot record a voice sample.");
      return;
    }
    const generation = state.captureGeneration;
    state.captureStarting = true;
    updateButtons();
    try {
      stopTracks(state.voiceStream);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (generation !== state.captureGeneration || !dialog.open) {
        stopTracks(stream);
        return;
      }
      state.voiceStream = stream;
      revokeUrl("voice");
      state.voiceBlob = null;
      state.voiceChunks = [];
      state.voiceSeconds = 0;
      state.voiceRecorder = new MediaRecorder(state.voiceStream, audioRecorderOptions());
      state.voiceRecorder.ondataavailable = event => { if (event.data?.size) state.voiceChunks.push(event.data); };
      state.voiceRecorder.onstop = () => finishVoiceRecording(generation);
      state.voiceRecorder.start(1000);
      state.voiceStartedAt = Date.now();
      voiceStage.dataset.state = "recording";
      $("voice-stop-button").disabled = false;
      $("voice-record-button").disabled = true;
      setProgress("voice-clone-status", "working", "Recording locally. Speak continuously in a quiet room.");
      const tick = () => {
        state.voiceSeconds = Math.min(VOICE_MAX_SECONDS, (Date.now() - state.voiceStartedAt) / 1000);
        $("voice-timer").textContent = `${formatClock(state.voiceSeconds)} / 01:30`;
        if (state.voiceSeconds >= VOICE_MAX_SECONDS) stopVoiceRecording();
      };
      tick();
      state.voiceTimer = setInterval(tick, 250);
    } catch (error) {
      stopTracks(state.voiceStream);
      state.voiceStream = null;
      voiceStage.dataset.state = "idle";
      setProgress("voice-clone-status", "error", error.name === "NotAllowedError"
        ? "Microphone permission was not granted."
        : `Voice recording could not start: ${error.message}`);
    } finally {
      state.captureStarting = false;
      updateButtons();
    }
  }

  function stopVoiceRecording() {
    if (state.voiceRecorder && state.voiceRecorder.state !== "inactive") state.voiceRecorder.stop();
  }

  function finishVoiceRecording(generation) {
    clearTimer("voice");
    const recorder = state.voiceRecorder;
    state.voiceRecorder = null;
    stopTracks(state.voiceStream);
    state.voiceStream = null;
    $("voice-stop-button").disabled = true;
    state.voiceSeconds = Math.max(state.voiceSeconds, (Date.now() - state.voiceStartedAt) / 1000);
    if (generation !== state.captureGeneration) {
      state.voiceChunks = [];
      state.voiceSeconds = 0;
      voiceStage.dataset.state = "idle";
      updateButtons();
      return;
    }
    if (state.voiceChunks.length) {
      state.voiceBlob = new Blob(state.voiceChunks, { type: recorder?.mimeType || "audio/webm" });
      revokeUrl("voice");
      state.voiceUrl = URL.createObjectURL(state.voiceBlob);
      $("voice-playback").src = state.voiceUrl;
      $("voice-playback").hidden = false;
    }
    voiceStage.dataset.state = state.voiceBlob ? "ready" : "idle";
    if (state.voiceSeconds < VOICE_MIN_SECONDS) {
      setProgress("voice-clone-status", "error", `This sample is only ${Math.floor(state.voiceSeconds)} seconds. Record at least ${VOICE_MIN_SECONDS} seconds.`);
    } else if (state.voiceSeconds < VOICE_RECOMMENDED_SECONDS) {
      setProgress("voice-clone-status", "waiting", "Usable sample recorded. For better quality, aim for 60–90 seconds.");
    } else {
      setProgress("voice-clone-status", "ready", "Sample ready for your review. Nothing has been uploaded.");
    }
    updateButtons();
  }

  async function createVoiceClone() {
    if (!state.voiceBlob || !consentReady() || state.voiceSeconds < VOICE_MIN_SECONDS || state.voiceSubmitting) return;
    state.voiceSubmitting = true;
    const actionGeneration = state.actionGeneration;
    updateButtons();
    setProgress("voice-clone-status", "working", "Creating your private voice with ElevenLabs…");
    try {
      const form = new FormData();
      form.append("audio", state.voiceBlob, state.voiceBlob.type.includes("mp4") ? "fluent-me-voice.m4a" : "fluent-me-voice.webm");
      form.append("name", `${$("clone-full-name").value.trim()} · Fluent Me voice`);
      form.append("consent", "true");
      const result = await fetchJSON("/api/personalization/voice", { method: "POST", body: form });
      if (actionGeneration !== state.actionGeneration) return;
      if (result.requires_verification) {
        state.pendingVoiceId = safeId(result.voice_id);
        state.voiceVerificationRequired = true;
        setProgress("voice-clone-status", "error", "ElevenLabs created the voice, but verification is required before it can be connected. Complete verification in ElevenLabs, then record again or reconnect from the provider dashboard.");
        discardVoiceMedia();
        return;
      }
      state.voiceVerificationRequired = false;
      state.pendingVoiceId = safeId(result.voice_id);
      setProgress("voice-clone-status", "working", "Voice created. Connecting it to your video coach…");
      const connected = await createPal("", state.pendingVoiceId);
      if (actionGeneration !== state.actionGeneration) return;
      if (!connected && !(state.profile.voice_id || state.profile.pal_id)) {
        saveProfile({ ...state.profile, voice_id: state.pendingVoiceId, pal_id: "" });
        setProgress("voice-clone-status", "error", "Your ElevenLabs voice exists, but it is not connected to a Tavus video coach yet. Reopen setup to retry.");
      }
      discardVoiceMedia();
    } catch (error) {
      setProgress("voice-clone-status", "error", error.message);
    } finally {
      state.voiceSubmitting = false;
      updateButtons();
    }
  }

  async function submitFace() {
    if (!consentReady() || state.faceSubmitting) return;
    state.faceSubmitting = true;
    const actionGeneration = state.actionGeneration;
    updateButtons();
    setProgress("face-training-status", "working", "Submitting the hosted video to Tavus…");
    try {
      const result = await fetchJSON("/api/personalization/face", {
        method: "POST",
        body: JSON.stringify({
          consent: true,
          face_name: $("face-name").value.trim() || `${$("clone-full-name").value.trim()} · Fluent Me Face`,
          train_video_url: $("training-url").value.trim(),
        }),
      });
      if (actionGeneration !== state.actionGeneration) return;
      state.pendingFaceId = safeId(result.face_id);
      setProgress("face-training-status", "working", "Training started. Tavus usually needs 3–4 hours. Keep this browser tab open for automatic tracking.");
      startFacePolling(state.pendingFaceId);
    } catch (error) {
      setProgress("face-training-status", "error", error.message);
    } finally {
      state.faceSubmitting = false;
      updateButtons();
    }
  }

  function startFacePolling(faceId) {
    clearInterval(state.facePoll);
    state.pendingFaceId = safeId(faceId);
    const generation = ++state.facePollGeneration;
    const actionGeneration = state.actionGeneration;
    const poll = async () => {
      try {
        const face = await fetchJSON(`/api/personalization/face/${encodeURIComponent(faceId)}`);
        if (actionGeneration !== state.actionGeneration || generation !== state.facePollGeneration || state.pendingFaceId !== faceId) return;
        const status = String(face.status || "started").toLowerCase();
        if (status === "completed") {
          clearInterval(state.facePoll);
          state.facePoll = null;
          setProgress("face-training-status", "ready", "Your Face is trained and ready to use.");
          if (state.profile.voice_id) {
            const connected = await createPal(
              faceId,
              state.voiceVerificationRequired ? "" : state.pendingVoiceId,
            );
            if (!connected) {
              setProgress("face-training-status", "error", "Your Face is trained, but it could not be connected to your current voice coach. Your existing coach remains active; retry when you reopen setup.");
            }
          } else {
            state.pendingFaceId = "";
            saveProfile({ ...state.profile, face_id: faceId });
          }
        } else if (status === "error") {
          clearInterval(state.facePoll);
          state.facePoll = null;
          state.pendingFaceId = "";
          setProgress("face-training-status", "error", face.error_message || face.error || "Tavus could not train this video.");
        } else {
          setProgress("face-training-status", "working", face.training_progress
            ? `Face training in progress: ${face.training_progress}. Keep this browser tab open for automatic tracking.`
            : "Face training is still running. Tavus usually needs 3–4 hours.");
        }
      } catch (error) {
        setProgress("face-training-status", "error", `Could not refresh Face status: ${error.message}`);
      }
    };
    void poll();
    state.facePoll = setInterval(poll, FACE_POLL_MS);
  }

  async function createPal(faceOverride = "", voiceOverride = "") {
    const nextVoiceId = safeId(voiceOverride) || state.profile.voice_id;
    if (!nextVoiceId || state.palSubmitting) return false;
    state.palSubmitting = true;
    const actionGeneration = state.actionGeneration;
    updateButtons();
    const nextFaceId = safeId(faceOverride) || state.profile.face_id;
    setProgress("voice-clone-status", "working", nextFaceId
      ? "Connecting your voice and Face to the coach…"
      : "Connecting your voice to the stock male coach…");
    try {
      const result = await fetchJSON("/api/personalization/pal", {
        method: "POST",
        body: JSON.stringify({ voice_id: nextVoiceId, face_id: nextFaceId || "" }),
      });
      if (actionGeneration !== state.actionGeneration) return false;
      saveProfile({ ...state.profile, face_id: nextFaceId, voice_id: nextVoiceId, pal_id: result.pal_id });
      if (faceOverride) state.pendingFaceId = "";
      if (voiceOverride) state.pendingVoiceId = "";
      if (voiceOverride) state.voiceVerificationRequired = false;
      setProgress("voice-clone-status", "ready", nextFaceId
        ? "Your Face and voice are connected."
        : "Your voice is connected to the stock male face.");
      return true;
    } catch (error) {
      setProgress("voice-clone-status", "error", `The voice exists, but the video coach is not connected yet: ${error.message}`);
      return false;
    } finally {
      state.palSubmitting = false;
      updateButtons();
    }
  }

  function discardFaceMedia() {
    revokeUrl("face");
    state.faceBlob = null;
    state.faceChunks = [];
    const playback = $("setup-recording-playback");
    playback.pause();
    playback.removeAttribute("src");
    playback.load();
    playback.hidden = true;
    $("setup-download-video").removeAttribute("href");
    $("setup-download-video").hidden = true;
    $("setup-audio-status").textContent = "No recording yet";
  }

  function discardVoiceMedia() {
    revokeUrl("voice");
    state.voiceBlob = null;
    state.voiceChunks = [];
    state.voiceSeconds = 0;
    const playback = $("voice-playback");
    playback.pause();
    playback.removeAttribute("src");
    playback.load();
    playback.hidden = true;
    $("voice-timer").textContent = "00:00 / 01:30";
    voiceStage.dataset.state = "idle";
  }

  function discardLocalMedia() {
    state.captureGeneration += 1;
    discardFaceMedia();
    discardVoiceMedia();
    $("training-url").value = "";
  }

  function stopCapture() {
    state.captureGeneration += 1;
    stopFaceRecording();
    stopVoiceRecording();
    stopTracks(state.faceStream);
    stopTracks(state.voiceStream);
    state.faceStream = null;
    state.voiceStream = null;
    discardFaceMedia();
    discardVoiceMedia();
  }

  function openDialog() {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    renderProfile();
    void loadProviderStatus();
    if (state.pendingVoiceId && !state.voiceVerificationRequired) void createPal(state.pendingFaceId, state.pendingVoiceId);
    else if (state.pendingFaceId && state.profile.voice_id) void createPal(state.pendingFaceId);
    else if (state.profile.voice_id && !state.profile.pal_id) void createPal();
    $("clone-full-name").focus();
  }

  function closeDialog() {
    stopCapture();
    $("training-url").value = "";
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  $("open-personalization").addEventListener("click", openDialog);
  $("close-personalization").addEventListener("click", closeDialog);
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog();
  });
  $("clone-full-name").addEventListener("input", updateConsentScript);
  $("consent-checkbox").addEventListener("change", updateButtons);
  $("training-url").addEventListener("input", updateButtons);
  $("setup-record-button").addEventListener("click", () => { void startFaceRecording(); });
  $("setup-stop-button").addEventListener("click", stopFaceRecording);
  $("voice-record-button").addEventListener("click", () => { void startVoiceRecording(); });
  $("voice-stop-button").addEventListener("click", stopVoiceRecording);
  $("clone-voice-button").addEventListener("click", () => { void createVoiceClone(); });
  $("create-face-button").addEventListener("click", () => { void submitFace(); });
  $("use-personal-coach").addEventListener("click", () => {
    if (!(state.profile.face_id || state.profile.pal_id)) return;
    saveProfile(state.profile);
    closeDialog();
  });
  $("reset-personal-coach").addEventListener("click", () => {
    const confirmed = window.confirm("Use the stock coach in this browser? This will not delete your Tavus Face, ElevenLabs voice, or personal PAL from either provider.");
    if (!confirmed) return;
    clearInterval(state.facePoll);
    state.facePoll = null;
    state.facePollGeneration += 1;
    state.actionGeneration += 1;
    state.faceSubmitting = false;
    state.voiceSubmitting = false;
    state.palSubmitting = false;
    state.pendingFaceId = "";
    state.pendingVoiceId = "";
    state.voiceVerificationRequired = false;
    discardLocalMedia();
    saveProfile(emptyProfile());
    setProgress("voice-clone-status", "waiting", "No personal voice is selected in this browser.");
    setProgress("face-training-status", "waiting", "No personal Face is selected in this browser.");
  });
  window.addEventListener("pagehide", stopCapture);

  window.FluentMePersonalization = {
    getProfile() { return { ...state.profile }; },
  };

  updateConsentScript();
  renderProfile();
})();
