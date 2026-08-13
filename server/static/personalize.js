(() => {
  "use strict";

  const PROFILE_KEY = "fluentMePersonalCoachV1";
  const JOBS_KEY = "fluentMePersonalCoachJobsV1";
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
  const emptyJobs = () => ({ pending_face_id: "", pending_face_started_at: 0, pending_face_path: "", pending_voice_id: "", voice_verification_required: false });
  const restoredJobs = loadJobs();
  const state = {
    profile: loadProfile(),
    path: "both",
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
    pendingFaceId: restoredJobs.pending_face_id,
    pendingFaceStartedAt: restoredJobs.pending_face_started_at,
    pendingFacePath: restoredJobs.pending_face_path,
    captureGeneration: 0,
    facePollGeneration: 0,
    pendingVoiceId: restoredJobs.pending_voice_id,
    voiceVerificationRequired: restoredJobs.voice_verification_required,
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

  function loadJobs() {
    try {
      const value = JSON.parse(localStorage.getItem(JOBS_KEY) || "{}");
      const startedAt = Number(value.pending_face_started_at);
      return {
        pending_face_id: safeId(value.pending_face_id),
        pending_face_started_at: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0,
        pending_face_path: ["face", "both"].includes(value.pending_face_path) ? value.pending_face_path : "",
        pending_voice_id: safeId(value.pending_voice_id),
        voice_verification_required: value.voice_verification_required === true,
      };
    } catch {
      return emptyJobs();
    }
  }

  function safeId(value) {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9_-]{6,128}$/.test(text) ? text : "";
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

  function saveJobs() {
    const jobs = {
      pending_face_id: safeId(state.pendingFaceId),
      pending_face_started_at: Number(state.pendingFaceStartedAt) || 0,
      pending_face_path: ["face", "both"].includes(state.pendingFacePath) ? state.pendingFacePath : "",
      pending_voice_id: safeId(state.pendingVoiceId),
      voice_verification_required: state.voiceVerificationRequired === true,
    };
    if (jobs.pending_face_id || jobs.pending_voice_id) localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
    else localStorage.removeItem(JOBS_KEY);
    renderPendingJobs();
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

  function clearFacePolling() {
    clearTimeout(state.facePoll);
    state.facePoll = null;
    state.facePollGeneration += 1;
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

  function pathIncludes(kind) {
    return state.path === "both" || state.path === kind;
  }

  function updatePersonalizationPath() {
    const selected = document.querySelector('input[name="personalization-path"]:checked');
    state.path = ["voice", "face", "both"].includes(selected?.value) ? selected.value : "both";
    document.querySelector(".personalization-shell").dataset.path = state.path;
    const scope = state.path === "voice"
      ? "I understand this creates a reusable biometric voice model."
      : state.path === "face"
        ? "I understand this creates a reusable biometric face model."
        : "I understand this creates reusable biometric voice and face models.";
    $("consent-scope-copy").textContent = scope;
    updateButtons();
  }

  function updateConsentScript() {
    const name = $("clone-full-name").value.trim() || "[FULL NAME]";
    $("consent-script").textContent = `“I, ${name}, am currently speaking and give consent to Tavus to create an AI clone of me by using the audio and video samples I provide. I understand that this AI clone can be used to create videos that look and sound like me.”`;
    updateButtons();
  }

  function updateButtons() {
    const allowed = consentReady();
    const recording = Boolean(state.captureStarting || state.faceRecorder || state.voiceRecorder);
    $("setup-record-button").disabled = !pathIncludes("face") || !allowed || recording;
    $("voice-record-button").disabled = !pathIncludes("voice") || !allowed || recording;
    $("clone-voice-button").disabled = !pathIncludes("voice") || !allowed || recording || !state.voiceBlob || state.voiceSeconds < VOICE_MIN_SECONDS || state.voiceSubmitting || state.palSubmitting;
    $("create-face-button").disabled = !pathIncludes("face") || !allowed || recording || !$("training-url").value.trim() || state.faceSubmitting;
    $("use-existing-face-button").disabled = !pathIncludes("face") || !allowed || recording || !safeId($("existing-face-id").value) || state.faceSubmitting || state.palSubmitting;
    $("use-personal-coach").disabled = recording || state.faceSubmitting || state.voiceSubmitting || state.palSubmitting || !(state.profile.face_id || state.profile.pal_id);
    $("retry-pal-button").disabled = recording || state.faceSubmitting || state.voiceSubmitting || state.palSubmitting;
  }

  function renderProfile() {
    const face = Boolean(state.profile.face_id);
    const voice = Boolean(state.profile.voice_id);
    const pal = Boolean(state.profile.pal_id);
    const active = face || pal;
    const label = face && voice && pal
      ? "Your face + voice ready"
      : pal
        ? "Your voice + stock face ready"
        : face
          ? "Your face + stock voice ready"
          : voice
            ? "Voice saved · connection pending"
          : "Stock coach active";
    $("personalization-status").textContent = label;
    const trigger = $("open-personalization");
    const triggerTitle = trigger?.querySelector("b");
    const triggerDetail = trigger?.querySelector("small");
    if (triggerTitle) triggerTitle.textContent = active ? "Your personal coach" : voice ? "Finish your coach" : "Create your coach";
    if (triggerDetail) triggerDetail.textContent = active ? "Active" : voice ? "Connection pending" : "Optional";
    if (trigger) trigger.setAttribute("aria-label", active || voice ? `${label}. Manage your coach` : "Create your coach (optional)");
    if (voice) setProgress("voice-clone-status", "ready", "Your personal voice is ready.");
    if (face) setProgress("face-training-status", "ready", "Your personal Face is trained and ready.");
    renderPendingJobs();
    updateButtons();
  }

  function renderPendingJobs() {
    const retry = $("retry-pal-button");
    if (state.pendingFaceId) {
      const age = state.pendingFaceStartedAt ? Math.max(0, Date.now() - state.pendingFaceStartedAt) : 0;
      const hours = Math.floor(age / 3_600_000);
      setProgress("face-training-status", "working", hours
        ? `Face training is still running (${hours}h elapsed). Status tracking resumes automatically.`
        : "Face training is still running. Status tracking resumes automatically.");
    }
    if (state.pendingVoiceId) {
      if (state.voiceVerificationRequired) {
        setProgress("voice-clone-status", "error", "Your saved ElevenLabs voice still requires provider verification before Tavus can use it.");
        retry.hidden = true;
      } else if (!state.profile.pal_id || state.profile.voice_id !== state.pendingVoiceId) {
        setProgress("voice-clone-status", "waiting", "A saved voice is waiting to be connected to your video coach.");
        retry.hidden = false;
      } else {
        retry.hidden = true;
      }
    } else {
      retry.hidden = true;
    }
  }

  async function loadProviderStatus() {
    $("eleven-plan").textContent = "Checking…";
    $("eleven-usage").textContent = "Checking…";
    $("eleven-voices").textContent = "Checking…";
    try {
      const status = await fetchJSON("/api/personalization/status");
      const eleven = status.elevenlabs || {};
      if (!status.tavus?.configured) {
        setProgress("face-training-status", "error", "Add TAVUS_API_KEY before submitting Face training.");
      }
      if (!eleven.configured) {
        $("eleven-plan").textContent = "API key needed";
        $("eleven-usage").textContent = "Grant not verified";
        $("eleven-voices").textContent = "Unavailable";
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
      const voiceSlotsUsed = Number(eleven.voice_slots_used);
      const voiceLimit = Number(eleven.voice_limit);
      $("eleven-voices").textContent = Number.isFinite(voiceLimit) && voiceLimit > 0
        ? `${Number.isFinite(voiceSlotsUsed) ? voiceSlotsUsed.toLocaleString() : "?"} / ${voiceLimit.toLocaleString()}`
        : "Unavailable";
      if (eleven.error) setProgress("voice-clone-status", "error", eleven.error);
    } catch (error) {
      $("eleven-plan").textContent = "Unavailable";
      $("eleven-usage").textContent = "Unavailable";
      $("eleven-voices").textContent = "Unavailable";
      setProgress("voice-clone-status", "error", error.message);
    }
  }

  async function startFaceRecording() {
    if (!pathIncludes("face") || !consentReady() || state.captureStarting || state.faceRecorder || state.voiceRecorder) return;
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
      if (state.faceRecorder && state.faceRecorder.state !== "inactive") {
        try { state.faceRecorder.stop(); } catch {}
      }
      state.faceRecorder = null;
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
      state.faceChunks = [];
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
    if (!pathIncludes("voice") || !consentReady() || state.captureStarting || state.faceRecorder || state.voiceRecorder) return;
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
      if (state.voiceRecorder && state.voiceRecorder.state !== "inactive") {
        try { state.voiceRecorder.stop(); } catch {}
      }
      state.voiceRecorder = null;
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
      state.voiceChunks = [];
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
    if (!pathIncludes("voice") || !state.voiceBlob || !consentReady() || state.voiceSeconds < VOICE_MIN_SECONDS || state.voiceSubmitting) return;
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
        saveJobs();
        setProgress("voice-clone-status", "error", "ElevenLabs created the voice, but verification is required before it can be connected. Complete verification in ElevenLabs, then record again or reconnect from the provider dashboard.");
        discardVoiceMedia();
        return;
      }
      state.voiceVerificationRequired = false;
      state.pendingVoiceId = safeId(result.voice_id);
      saveJobs();
      setProgress("voice-clone-status", "working", "Voice created. Connecting it to your video coach…");
      const connected = await createPal("", state.pendingVoiceId);
      if (actionGeneration !== state.actionGeneration) return;
      if (!connected && !(state.profile.voice_id || state.profile.pal_id)) {
        saveProfile({
          ...state.profile,
          face_id: state.path === "voice" ? "" : state.profile.face_id,
          voice_id: state.pendingVoiceId,
          pal_id: "",
        });
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
    if (!pathIncludes("face") || !consentReady() || state.faceSubmitting) return;
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
      state.pendingFaceStartedAt = Date.now();
      state.pendingFacePath = state.path === "face" ? "face" : "both";
      saveJobs();
      setProgress("face-training-status", "working", "Training started. Tavus usually needs 3–4 hours. Keep this browser tab open for automatic tracking.");
      startFacePolling(state.pendingFaceId);
    } catch (error) {
      setProgress("face-training-status", "error", error.message);
    } finally {
      state.faceSubmitting = false;
      updateButtons();
    }
  }

  async function useExistingFace() {
    const faceId = safeId($("existing-face-id").value);
    if (!pathIncludes("face") || !faceId || !consentReady() || state.faceSubmitting) return;
    state.faceSubmitting = true;
    const actionGeneration = state.actionGeneration;
    updateButtons();
    setProgress("face-training-status", "working", "Checking this Face with Tavus…");
    try {
      const face = await fetchJSON(`/api/personalization/face/${encodeURIComponent(faceId)}`);
      if (actionGeneration !== state.actionGeneration) return;
      const status = String(face.status || "started").toLowerCase();
      if (status === "error") {
        setProgress("face-training-status", "error", face.error || "Tavus reports that this Face could not be trained.");
        return;
      }
      if (status !== "completed") {
        state.pendingFaceId = faceId;
        state.pendingFaceStartedAt = Date.now();
        state.pendingFacePath = state.path === "face" ? "face" : "both";
        saveJobs();
        setProgress("face-training-status", "working", "This Face is still training. You can close this tab; tracking will resume automatically.");
        startFacePolling(faceId);
        return;
      }
      state.pendingFaceId = "";
      state.pendingFaceStartedAt = 0;
      const facePath = state.path === "face" ? "face" : "both";
      state.pendingFacePath = "";
      saveJobs();
      saveProfile(facePath === "face"
        ? { face_id: faceId, voice_id: "", pal_id: "" }
        : { ...state.profile, face_id: faceId, pal_id: "" });
      const voiceId = facePath === "both" && !state.voiceVerificationRequired
        ? (state.pendingVoiceId || state.profile.voice_id)
        : "";
      if (voiceId) {
        const connected = await createPal(faceId, voiceId, { useFace: true });
        if (!connected) setProgress("face-training-status", "ready", "Your Face is connected with the stock voice. Your personal voice can be retried later.");
      } else {
        setProgress("face-training-status", "ready", "Your Face is connected and will use the stock voice.");
      }
    } catch (error) {
      setProgress("face-training-status", "error", error.message);
    } finally {
      state.faceSubmitting = false;
      updateButtons();
    }
  }

  function startFacePolling(faceId) {
    clearFacePolling();
    state.pendingFaceId = safeId(faceId);
    if (!state.pendingFaceId) return;
    if (!state.pendingFaceStartedAt) state.pendingFaceStartedAt = Date.now();
    if (!state.pendingFacePath) state.pendingFacePath = state.path === "face" ? "face" : "both";
    saveJobs();
    const generation = ++state.facePollGeneration;
    const actionGeneration = state.actionGeneration;
    const scheduleNext = () => {
      if (actionGeneration !== state.actionGeneration || generation !== state.facePollGeneration || state.pendingFaceId !== faceId) return;
      state.facePoll = setTimeout(() => { void poll(); }, FACE_POLL_MS);
    };
    const poll = async () => {
      state.facePoll = null;
      try {
        const face = await fetchJSON(`/api/personalization/face/${encodeURIComponent(faceId)}`);
        if (actionGeneration !== state.actionGeneration || generation !== state.facePollGeneration || state.pendingFaceId !== faceId) return;
        const status = String(face.status || "started").toLowerCase();
        if (status === "completed") {
          state.pendingFaceId = "";
          state.pendingFaceStartedAt = 0;
          const facePath = state.pendingFacePath || "both";
          state.pendingFacePath = "";
          saveJobs();
          saveProfile(facePath === "face"
            ? { face_id: faceId, voice_id: "", pal_id: "" }
            : { ...state.profile, face_id: faceId, pal_id: "" });
          setProgress("face-training-status", "ready", "Your Face is trained and ready to use.");
          const voiceId = facePath === "both" && !state.voiceVerificationRequired
            ? (state.pendingVoiceId || state.profile.voice_id)
            : "";
          if (voiceId) {
            const connected = await createPal(
              faceId,
              voiceId,
              { useFace: true },
            );
            if (!connected) {
              setProgress("face-training-status", "ready", "Your Face is trained. Voice connection is still pending; your Face can already use the stock voice.");
            }
          }
          return;
        } else if (status === "error") {
          state.pendingFaceId = "";
          state.pendingFaceStartedAt = 0;
          state.pendingFacePath = "";
          saveJobs();
          setProgress("face-training-status", "error", face.error || "Tavus could not train this video. Review the recording requirements and try again.");
          return;
        } else {
          setProgress("face-training-status", "working", face.training_progress
            ? `Face training in progress: ${face.training_progress}. You can close this tab; tracking resumes next time.`
            : "Face training is still running. You can close this tab; tracking resumes next time.");
        }
      } catch (error) {
        setProgress("face-training-status", "working", "Face training is still saved. Status could not refresh just now, so Fluent Me will try again automatically.");
      }
      scheduleNext();
    };
    void poll();
  }

  async function createPal(faceOverride = "", voiceOverride = "", { useFace = state.path !== "voice" } = {}) {
    const nextVoiceId = safeId(voiceOverride) || state.profile.voice_id;
    if (!nextVoiceId || state.palSubmitting) return false;
    state.palSubmitting = true;
    const actionGeneration = state.actionGeneration;
    updateButtons();
    const nextFaceId = useFace
      ? (safeId(faceOverride) || state.profile.face_id)
      : "";
    setProgress("voice-clone-status", "working", nextFaceId
      ? "Connecting your voice and Face to the coach…"
      : "Connecting your voice to the stock male coach…");
    try {
      const result = await fetchJSON("/api/personalization/pal", {
        method: "POST",
        body: JSON.stringify({ voice_id: nextVoiceId, face_id: nextFaceId || "" }),
      });
      if (actionGeneration !== state.actionGeneration) return false;
      saveProfile({
        ...state.profile,
        face_id: useFace ? nextFaceId : "",
        voice_id: nextVoiceId,
        pal_id: result.pal_id,
      });
      if (faceOverride) {
        state.pendingFaceId = "";
        state.pendingFaceStartedAt = 0;
        state.pendingFacePath = "";
      }
      if (voiceOverride) {
        state.pendingVoiceId = "";
        state.voiceVerificationRequired = false;
      }
      saveJobs();
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
    if (state.pendingFaceId && !state.facePoll) startFacePolling(state.pendingFaceId);
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
  document.querySelectorAll('input[name="personalization-path"]').forEach(input => input.addEventListener("change", updatePersonalizationPath));
  $("training-url").addEventListener("input", updateButtons);
  $("existing-face-id").addEventListener("input", updateButtons);
  $("setup-record-button").addEventListener("click", () => { void startFaceRecording(); });
  $("setup-stop-button").addEventListener("click", stopFaceRecording);
  $("voice-record-button").addEventListener("click", () => { void startVoiceRecording(); });
  $("voice-stop-button").addEventListener("click", stopVoiceRecording);
  $("clone-voice-button").addEventListener("click", () => { void createVoiceClone(); });
  $("create-face-button").addEventListener("click", () => { void submitFace(); });
  $("use-existing-face-button").addEventListener("click", () => { void useExistingFace(); });
  $("retry-pal-button").addEventListener("click", () => {
    if (!state.pendingVoiceId) return;
    void createPal(state.profile.face_id, state.pendingVoiceId);
  });
  $("use-personal-coach").addEventListener("click", () => {
    if (!(state.profile.face_id || state.profile.pal_id)) return;
    saveProfile(state.profile);
    closeDialog();
  });
  $("reset-personal-coach").addEventListener("click", () => {
    const confirmed = window.confirm("Use the stock coach in this browser? This will not delete your Tavus Face, ElevenLabs voice, or personal PAL from either provider.");
    if (!confirmed) return;
    clearFacePolling();
    state.actionGeneration += 1;
    state.faceSubmitting = false;
    state.voiceSubmitting = false;
    state.palSubmitting = false;
    state.pendingFaceId = "";
    state.pendingFaceStartedAt = 0;
    state.pendingFacePath = "";
    state.pendingVoiceId = "";
    state.voiceVerificationRequired = false;
    saveJobs();
    discardLocalMedia();
    saveProfile(emptyProfile());
    setProgress("voice-clone-status", "waiting", "No personal voice is selected in this browser.");
    setProgress("face-training-status", "waiting", "No personal Face is selected in this browser.");
  });
  window.addEventListener("pagehide", stopCapture);

  window.FluentMePersonalization = {
    getProfile() { return { ...state.profile }; },
  };

  updatePersonalizationPath();
  updateConsentScript();
  renderProfile();
  if (state.pendingFaceId) startFacePolling(state.pendingFaceId);
})();
