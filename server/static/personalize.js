(() => {
  "use strict";

  const PROFILE_KEY = "fluentMePersonalCoachV1";
  const JOBS_KEY = "fluentMePersonalCoachJobsV1";
  const ORIGINAL_VOICE_KEY = "fluentMeOriginalVoiceV1";
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
  const emptyProfile = () => ({
    face_id: "",
    voice_id: "",
    pal_id: "",
    voice_kind: "original",
    future_voice_id: "",
    future_target_accent: "",
    future_strength: "",
  });
  const emptyJobs = () => ({
    pending_face_id: "",
    pending_face_started_at: 0,
    pending_face_path: "",
    pending_voice_id: "",
    pending_voice_kind: "",
    pending_voice_target_accent: "",
    pending_voice_strength: "",
    voice_verification_required: false,
  });
  const restoredProfile = loadProfile();
  const restoredJobs = loadJobs();
  const state = {
    profile: restoredProfile,
    originalVoiceId: loadOriginalVoiceId() || restoredProfile.voice_id,
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
    remixProviderAvailable: null,
    remixSubmitting: false,
    remixSaving: false,
    remixPreviews: { low: null, medium: null },
    remixSelection: restoredProfile.voice_kind === "future" && ["low", "medium"].includes(restoredProfile.future_strength)
      ? restoredProfile.future_strength
      : "original",
    remixGeneration: 0,
    originalPreviewSource: "",
    pendingFaceId: restoredJobs.pending_face_id,
    pendingFaceStartedAt: restoredJobs.pending_face_started_at,
    pendingFacePath: restoredJobs.pending_face_path,
    captureGeneration: 0,
    facePollGeneration: 0,
    pendingVoiceId: restoredJobs.pending_voice_id,
    pendingVoiceKind: restoredJobs.pending_voice_kind,
    pendingVoiceTargetAccent: restoredJobs.pending_voice_target_accent,
    pendingVoiceStrength: restoredJobs.pending_voice_strength,
    voiceVerificationRequired: restoredJobs.voice_verification_required,
    captureStarting: false,
    actionGeneration: 0,
  };

  function loadProfile() {
    try {
      const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      const voiceId = safeId(value.voice_id);
      const futureVoiceId = safeId(value.future_voice_id);
      const futureStrength = safeRemixStrength(value.future_strength);
      const futureTargetAccent = safeTargetAccent(value.future_target_accent);
      return {
        face_id: safeId(value.face_id),
        voice_id: voiceId,
        pal_id: safeId(value.pal_id),
        voice_kind: value.voice_kind === "future" && futureVoiceId && voiceId === futureVoiceId ? "future" : "original",
        future_voice_id: futureVoiceId,
        future_target_accent: futureTargetAccent,
        future_strength: futureStrength,
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
        pending_voice_kind: ["original", "future"].includes(value.pending_voice_kind) ? value.pending_voice_kind : "",
        pending_voice_target_accent: safeTargetAccent(value.pending_voice_target_accent),
        pending_voice_strength: safeRemixStrength(value.pending_voice_strength),
        voice_verification_required: value.voice_verification_required === true,
      };
    } catch {
      return emptyJobs();
    }
  }

  function loadOriginalVoiceId() {
    try {
      return safeId(localStorage.getItem(ORIGINAL_VOICE_KEY));
    } catch {
      return "";
    }
  }

  function saveOriginalVoiceId(voiceId) {
    const previousVoiceId = state.originalVoiceId;
    state.originalVoiceId = safeId(voiceId);
    try {
      if (state.originalVoiceId) localStorage.setItem(ORIGINAL_VOICE_KEY, state.originalVoiceId);
      else localStorage.removeItem(ORIGINAL_VOICE_KEY);
    } catch {}
    if (previousVoiceId && previousVoiceId !== state.originalVoiceId) {
      clearOriginalRemixPreview();
      resetRemixPreviews("Your original clone changed. Generate fresh previews from the new voice.");
    }
    renderRemixAvailability();
  }

  function safeId(value) {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9_-]{6,128}$/.test(text) ? text : "";
  }

  function safeTargetAccent(value) {
    return ["general_american", "modern_british"].includes(value) ? value : "";
  }

  function safeRemixStrength(value) {
    return ["low", "medium"].includes(value) ? value : "";
  }

  function safePreviewHandle(value) {
    const text = String(value || "").trim();
    return /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text) && text.length <= 4096 ? text : "";
  }

  function saveProfile(next) {
    const voiceId = safeId(next.voice_id);
    const futureVoiceId = safeId(next.future_voice_id);
    const voiceKind = next.voice_kind === "future" && futureVoiceId && voiceId === futureVoiceId ? "future" : "original";
    state.profile = {
      face_id: safeId(next.face_id),
      voice_id: voiceId,
      pal_id: safeId(next.pal_id),
      voice_kind: voiceKind,
      future_voice_id: futureVoiceId,
      future_target_accent: safeTargetAccent(next.future_target_accent),
      future_strength: safeRemixStrength(next.future_strength),
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
      pending_voice_kind: ["original", "future"].includes(state.pendingVoiceKind) ? state.pendingVoiceKind : "",
      pending_voice_target_accent: safeTargetAccent(state.pendingVoiceTargetAccent),
      pending_voice_strength: safeRemixStrength(state.pendingVoiceStrength),
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

  function renderRemixAvailability() {
    const remix = $("voice-remix");
    if (!remix) return;
    const available = Boolean(state.originalVoiceId) && state.remixProviderAvailable === true;
    remix.hidden = !available;
    if (!available) return;
    $("remix-choice-original").disabled = false;
    restoreSavedFuturePreview();
    const persistedChoice = safeRemixStrength(state.remixSelection);
    if (persistedChoice && !$("remix-choice-" + persistedChoice).disabled) {
      $("remix-choice-" + persistedChoice).checked = true;
    }
    renderRemixActiveState();
    updateRemixChoice();
    updateButtons();
  }

  function remixAccentLabel(value) {
    return value === "modern_british" ? "General British" : "General American";
  }

  function remixChoiceName(value) {
    return value === "low" ? "Subtle" : value === "medium" ? "Balanced" : "Original";
  }

  function restoreSavedFuturePreview() {
    const strength = safeRemixStrength(state.profile.future_strength);
    const savedVoiceId = safeId(state.profile.future_voice_id);
    if (!strength || !savedVoiceId || state.remixPreviews[strength]) return;
    renderRemixPreview(strength, {
      generatedVoiceId: "",
      savedVoiceId,
      audioSource: "",
      durationSeconds: 0,
      targetAccent: safeTargetAccent(state.profile.future_target_accent),
    });
  }

  function renderRemixActiveState() {
    const current = $("voice-remix-current");
    const isFuture = state.profile.voice_kind === "future" && Boolean(state.profile.future_voice_id);
    if (current) {
      current.textContent = isFuture
        ? `Active voice: ${remixChoiceName(state.profile.future_strength)} Future Me · ${remixAccentLabel(state.profile.future_target_accent)}`
        : "Active voice: Original";
    }
    for (const choice of ["original", "low", "medium"]) {
      const preview = choice === "original" ? null : state.remixPreviews[choice];
      const representedVoiceId = choice === "original" ? state.originalVoiceId : safeId(preview?.savedVoiceId);
      const active = Boolean(representedVoiceId)
        && representedVoiceId === state.profile.voice_id
        && ((choice === "original" && !isFuture) || (choice !== "original" && isFuture));
      const badge = $("remix-active-" + choice);
      const option = choice === "original" ? $("remix-choice-original")?.closest(".voice-remix-option") : $("remix-option-" + choice);
      if (badge) badge.hidden = !active;
      if (option) option.dataset.active = active ? "true" : "false";
    }
  }

  function selectedRemixVoiceId() {
    if (state.remixSelection === "original") return state.originalVoiceId;
    return safeId(state.remixPreviews[state.remixSelection]?.savedVoiceId);
  }

  function selectedRemixIsActive() {
    const voiceId = selectedRemixVoiceId();
    if (!voiceId || voiceId !== state.profile.voice_id) return false;
    return state.remixSelection === "original" ? state.profile.voice_kind !== "future" : state.profile.voice_kind === "future";
  }

  function updateRemixChoice() {
    const selected = document.querySelector('input[name="voice-remix-choice"]:checked');
    state.remixSelection = ["original", "low", "medium"].includes(selected?.value) ? selected.value : "original";
    const button = $("connect-remix-button");
    if (!button) return;
    const label = button.querySelector("span") || button;
    const choiceName = remixChoiceName(state.remixSelection);
    const preview = state.remixSelection === "original" ? null : state.remixPreviews[state.remixSelection];
    label.textContent = selectedRemixIsActive()
      ? `${choiceName} is active`
      : state.remixSelection === "original"
        ? "Connect original voice"
        : preview?.savedVoiceId
          ? `Connect saved ${choiceName}`
          : `Save & connect ${choiceName}`;
    updateButtons();
  }

  function updateRemixGenerateLabel() {
    const readyCount = ["low", "medium"].filter(strength => state.remixPreviews[strength]?.previewHandle && state.remixPreviews[strength]?.audioSource).length;
    $("generate-remix-button").textContent = readyCount === 1
      ? "Retry missing preview"
      : readyCount === 2
        ? "Regenerate previews"
        : "Generate previews";
  }

  function resetRemixPreviews(message = "Choose an accent, then generate both previews.") {
    state.remixGeneration += 1;
    state.remixPreviews = { low: null, medium: null };
    state.remixSelection = "original";
    for (const strength of ["low", "medium"]) {
      const radio = $(`remix-choice-${strength}`);
      const audio = $(`remix-${strength}-audio`);
      const option = $(`remix-option-${strength}`);
      radio.disabled = true;
      radio.checked = false;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.hidden = true;
      option.dataset.remixState = "waiting";
      $(`remix-${strength}-copy`).textContent = "Generate a preview to compare it with your original.";
    }
    $("remix-choice-original").checked = true;
    setProgress("voice-remix-status", "waiting", message);
    renderRemixActiveState();
    updateRemixGenerateLabel();
    updateRemixChoice();
  }

  function safePreviewUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, window.location.origin);
      return url.protocol === "https:" || (url.protocol === "http:" && url.origin === window.location.origin) ? url.href : "";
    } catch {
      return "";
    }
  }

  function clearOriginalRemixPreview() {
    state.originalPreviewSource = "";
    const audio = $("remix-original-audio");
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.hidden = true;
    $("remix-original-copy").textContent = "A source voice preview is not available. Your original clone still remains unchanged.";
  }

  function renderOriginalRemixPreview(payload) {
    const source = safePreviewUrl(payload?.source_preview_url || payload?.original_preview_url || payload?.source_preview?.url);
    if (!source || source === state.originalPreviewSource) return;
    state.originalPreviewSource = source;
    const audio = $("remix-original-audio");
    audio.src = source;
    audio.hidden = false;
    $("remix-original-copy").textContent = "Source voice preview ready. It may use different words, so compare voice character and accent rather than timing.";
  }

  function remixAudioSource(preview) {
    const url = String(preview?.audio_url || preview?.preview_url || preview?.url || "").trim();
    if (url) return url;
    const encoded = String(preview?.audio_base_64 || preview?.audio_base64 || preview?.audio_data || preview?.audio || "").trim();
    if (!encoded) return "";
    if (encoded.startsWith("data:")) return encoded;
    const rawType = String(preview?.media_type || preview?.mime_type || "audio/mpeg").toLowerCase();
    const mimeType = rawType.includes("/") ? rawType : rawType.includes("wav") ? "audio/wav" : rawType.includes("webm") ? "audio/webm" : "audio/mpeg";
    return `data:${mimeType};base64,${encoded}`;
  }

  function remixPreviewFrom(payload, strength) {
    const candidates = Array.isArray(payload?.previews)
      ? payload.previews
      : [payload?.preview, payload].filter(Boolean);
    const preview = candidates.find(item => String(item?.strength || "").toLowerCase() === strength)
      || (candidates.length === 1 ? candidates[0] : null);
    const generatedVoiceId = safeId(preview?.generated_voice_id || preview?.voice_id);
    const previewHandle = safePreviewHandle(preview?.preview_handle);
    if (!generatedVoiceId || !previewHandle) return null;
    return {
      generatedVoiceId,
      previewHandle,
      savedVoiceId: "",
      audioSource: remixAudioSource(preview),
      durationSeconds: Number(preview?.duration_secs || preview?.duration_seconds) || 0,
      targetAccent: safeTargetAccent(payload?.target_accent),
    };
  }

  function renderRemixPreview(strength, preview) {
    state.remixPreviews[strength] = preview;
    const option = $(`remix-option-${strength}`);
    const radio = $(`remix-choice-${strength}`);
    const audio = $(`remix-${strength}-audio`);
    option.dataset.remixState = preview ? "ready" : "waiting";
    radio.disabled = !preview;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.hidden = true;
    if (!preview) {
      $(`remix-${strength}-copy`).textContent = "Generate a preview to compare it with your original.";
      renderRemixActiveState();
      updateRemixGenerateLabel();
      return;
    }
    const name = strength === "low" ? "Subtle" : "Balanced";
    $(`remix-${strength}-copy`).textContent = preview.audioSource
      ? `${name} preview ready. Listen before choosing it.`
      : preview.savedVoiceId
        ? `${name} Future Me is saved. Generate previews if you want to hear a fresh same-text sample.`
        : `${name} voice is ready, but no playable preview was returned.`;
    if (preview.audioSource) {
      audio.src = preview.audioSource;
      audio.hidden = false;
    }
    renderRemixActiveState();
    updateRemixGenerateLabel();
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
    const personalizationBusy = state.faceSubmitting || state.voiceSubmitting || state.palSubmitting || state.remixSubmitting || state.remixSaving;
    $("setup-record-button").disabled = !pathIncludes("face") || !allowed || recording;
    $("voice-record-button").disabled = !pathIncludes("voice") || !allowed || recording;
    $("clone-voice-button").disabled = !pathIncludes("voice") || !allowed || recording || !state.voiceBlob || state.voiceSeconds < VOICE_MIN_SECONDS || personalizationBusy;
    $("create-face-button").disabled = !pathIncludes("face") || !allowed || recording || !$("training-url").value.trim() || state.faceSubmitting;
    $("use-existing-face-button").disabled = !pathIncludes("face") || !allowed || recording || !safeId($("existing-face-id").value) || personalizationBusy;
    $("use-personal-coach").disabled = recording || personalizationBusy || !(state.profile.face_id || state.profile.pal_id);
    $("retry-pal-button").disabled = recording || personalizationBusy;
    const remixConsentReady = $("remix-consent-checkbox").checked;
    const remixReady = pathIncludes("voice") && allowed && remixConsentReady && !recording && Boolean(state.originalVoiceId) && state.remixProviderAvailable === true;
    $("generate-remix-button").disabled = !remixReady || personalizationBusy;
    const selectedPreview = state.remixSelection === "original"
      ? Boolean(state.originalVoiceId)
      : Boolean(state.remixPreviews[state.remixSelection]?.savedVoiceId || state.remixPreviews[state.remixSelection]?.previewHandle);
    $("connect-remix-button").disabled = !remixReady || personalizationBusy || !selectedPreview || selectedRemixIsActive();
    $("remix-target-accent").disabled = !remixReady || personalizationBusy;
  }

  function renderProfile() {
    const face = Boolean(state.profile.face_id);
    const voice = Boolean(state.profile.voice_id);
    const pal = Boolean(state.profile.pal_id);
    const active = face || pal;
    const baseLabel = face && voice && pal
      ? "Your face + voice ready"
      : pal
        ? "Your voice + stock face ready"
        : face
          ? "Your face + stock voice ready"
          : voice
            ? "Voice saved · connection pending"
          : "Stock coach active";
    const label = voice && state.profile.voice_kind === "future"
      ? `${baseLabel} · ${remixChoiceName(state.profile.future_strength)} Future Me`
      : baseLabel;
    $("personalization-status").textContent = label;
    const trigger = $("open-personalization");
    const triggerTitle = trigger?.querySelector("b");
    const triggerDetail = trigger?.querySelector("small");
    if (triggerTitle) triggerTitle.textContent = active ? "Your personal coach" : voice ? "Finish your coach" : "Create your coach";
    if (triggerDetail) triggerDetail.textContent = active
      ? (state.profile.voice_kind === "future" ? "Future Me active" : "Original voice active")
      : voice ? "Connection pending" : "Optional";
    if (trigger) trigger.setAttribute("aria-label", active || voice ? `${label}. Manage your coach` : "Create your coach (optional)");
    if (voice) setProgress("voice-clone-status", "ready", "Your personal voice is ready.");
    if (face) setProgress("face-training-status", "ready", "Your personal Face is trained and ready.");
    if (voice && !state.originalVoiceId) saveOriginalVoiceId(state.profile.voice_id);
    else renderRemixAvailability();
    renderRemixActiveState();
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
        state.remixProviderAvailable = false;
        renderRemixAvailability();
        $("eleven-plan").textContent = "API key needed";
        $("eleven-usage").textContent = "Grant not verified";
        $("eleven-voices").textContent = "Unavailable";
        setProgress("voice-clone-status", "error", "Add ELEVENLABS_API_KEY after accepting your grant or enabling an IVC plan.");
        return;
      }
      const tier = String(eleven.tier || "Configured");
      const ivc = eleven.can_use_instant_voice_cloning;
      const remixStrengths = Array.isArray(eleven.remix_strengths) ? eleven.remix_strengths.map(value => String(value).toLowerCase()) : [];
      const hasRequiredStrengths = remixStrengths.length === 0 || (["low", "medium"].every(value => remixStrengths.includes(value)));
      state.remixProviderAvailable = eleven.voice_remixing_available !== false && hasRequiredStrengths;
      renderRemixAvailability();
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
      state.remixProviderAvailable = false;
      renderRemixAvailability();
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
      const createdVoiceId = safeId(result.voice_id);
      if (createdVoiceId) saveOriginalVoiceId(createdVoiceId);
      if (result.requires_verification) {
        state.pendingVoiceId = createdVoiceId;
        state.pendingVoiceKind = "original";
        state.pendingVoiceTargetAccent = "";
        state.pendingVoiceStrength = "";
        state.voiceVerificationRequired = true;
        saveJobs();
        setProgress("voice-clone-status", "error", "ElevenLabs created the voice, but verification is required before it can be connected. Complete verification in ElevenLabs, then record again or reconnect from the provider dashboard.");
        discardVoiceMedia();
        return;
      }
      state.voiceVerificationRequired = false;
      state.pendingVoiceId = createdVoiceId;
      state.pendingVoiceKind = "original";
      state.pendingVoiceTargetAccent = "";
      state.pendingVoiceStrength = "";
      saveJobs();
      setProgress("voice-clone-status", "working", "Voice created. Connecting it to your video coach…");
      const connected = await createPal("", state.pendingVoiceId, { voiceKind: "original", clearFuture: true });
      if (actionGeneration !== state.actionGeneration) return;
      if (!connected && !(state.profile.voice_id || state.profile.pal_id)) {
        saveProfile({
          ...state.profile,
          face_id: state.path === "voice" ? "" : state.profile.face_id,
          voice_id: state.pendingVoiceId,
          pal_id: "",
          voice_kind: "original",
          future_voice_id: "",
          future_target_accent: "",
          future_strength: "",
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

  async function generateRemixPreviews() {
    if (!pathIncludes("voice") || !consentReady() || !$("remix-consent-checkbox").checked || !state.originalVoiceId || state.remixProviderAvailable !== true || state.remixSubmitting || state.remixSaving) return;
    const allStrengths = ["low", "medium"];
    let strengths = allStrengths.filter(strength => !(state.remixPreviews[strength]?.previewHandle && state.remixPreviews[strength]?.audioSource));
    if (!strengths.length) {
      resetRemixPreviews("Regenerating Subtle and Balanced previews. This uses ElevenLabs credits…");
      strengths = allStrengths;
    } else {
      state.remixGeneration += 1;
      setProgress("voice-remix-status", "working", strengths.length === 1
        ? `Retrying the missing ${remixChoiceName(strengths[0])} preview. The successful preview is preserved.`
        : "Generating Subtle and Balanced previews. This uses ElevenLabs credits…");
    }
    const remixGeneration = state.remixGeneration;
    const actionGeneration = state.actionGeneration;
    const targetAccent = $("remix-target-accent").value === "modern_british" ? "modern_british" : "general_american";
    state.remixSubmitting = true;
    for (const strength of strengths) $("remix-option-" + strength).dataset.remixState = "working";
    updateButtons();
    try {
      const settled = await Promise.allSettled(strengths.map(async strength => {
        const result = await fetchJSON("/api/personalization/voice/remix", {
          method: "POST",
          body: JSON.stringify({
            voice_id: state.originalVoiceId,
            strength,
            target_accent: targetAccent,
            consent: true,
          }),
        });
        renderOriginalRemixPreview(result);
        return { strength, preview: remixPreviewFrom(result, strength) };
      }));
      if (actionGeneration !== state.actionGeneration || remixGeneration !== state.remixGeneration) return;
      const errors = [];
      let newReadyCount = 0;
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value.preview) {
          renderRemixPreview(result.value.strength, result.value.preview);
          newReadyCount += 1;
        } else {
          const strength = result.status === "fulfilled" ? result.value.strength : strengths[settled.indexOf(result)];
          renderRemixPreview(strength, null);
          restoreSavedFuturePreview();
          errors.push(result.status === "rejected" ? result.reason?.message : `${strength} preview was not returned.`);
        }
      }
      const readyCount = allStrengths.filter(strength => state.remixPreviews[strength]?.previewHandle && state.remixPreviews[strength]?.audioSource).length;
      if (!newReadyCount && !readyCount) throw new Error(errors.filter(Boolean)[0] || "ElevenLabs could not create a Future Me preview.");
      setProgress("voice-remix-status", readyCount === 2 ? "ready" : "waiting", readyCount === 2
        ? "Both previews are ready. Listen, select one card, then save and connect it."
        : "One preview is ready. You can select it now or retry only the missing preview.");
    } catch (error) {
      const unavailable = /not configured|unavailable|not supported|permission|forbidden|api key|plan|entitlement/i.test(error.message);
      if (unavailable) {
        state.remixProviderAvailable = false;
        setProgress("voice-clone-status", "error", "Future Me remixing is unavailable on this ElevenLabs account. Your original clone is unchanged.");
        renderRemixAvailability();
      } else {
        setProgress("voice-remix-status", "error", `${error.message} Your original clone is unchanged.`);
      }
    } finally {
      state.remixSubmitting = false;
      updateButtons();
    }
  }

  async function connectRemixChoice() {
    if (!pathIncludes("voice") || !consentReady() || !$("remix-consent-checkbox").checked || !state.originalVoiceId || state.remixProviderAvailable !== true || state.remixSubmitting || state.remixSaving || selectedRemixIsActive()) return;
    const selection = state.remixSelection;
    const preview = selection === "original" ? null : state.remixPreviews[selection];
    if (selection !== "original" && !(preview?.savedVoiceId || preview?.previewHandle)) return;
    state.remixSaving = true;
    const actionGeneration = state.actionGeneration;
    updateButtons();
    try {
      let nextVoiceId = state.originalVoiceId;
      if (preview?.savedVoiceId) {
        nextVoiceId = safeId(preview.savedVoiceId);
        setProgress("voice-remix-status", "working", `Connecting your saved ${remixChoiceName(selection)} Future Me voice…`);
      } else if (preview) {
        const displayName = selection === "low" ? "Subtle" : "Balanced";
        const accentName = $("remix-target-accent").value === "modern_british" ? "General British" : "General American";
        setProgress("voice-remix-status", "working", `Saving ${displayName} Future Me as a new voice. Your original stays unchanged…`);
        const result = await fetchJSON("/api/personalization/voice/remix/save", {
          method: "POST",
          body: JSON.stringify({
            preview_handle: preview.previewHandle,
            name: `${$("clone-full-name").value.trim()} · Future Me · ${accentName} · ${displayName}`,
            consent: true,
          }),
        });
        if (actionGeneration !== state.actionGeneration) return;
        nextVoiceId = safeId(result.voice_id);
        if (!nextVoiceId) throw new Error("The saved Future Me voice did not return a valid Voice ID.");
        preview.savedVoiceId = nextVoiceId;
        state.pendingVoiceId = nextVoiceId;
        state.pendingVoiceKind = "future";
        state.pendingVoiceTargetAccent = $("remix-target-accent").value === "modern_british" ? "modern_british" : "general_american";
        state.pendingVoiceStrength = selection;
        state.voiceVerificationRequired = false;
        saveJobs();
      } else {
        setProgress("voice-remix-status", "working", "Connecting your unchanged original voice…");
      }
      const connected = await createPal(state.profile.face_id, nextVoiceId, {
        useFace: state.path !== "voice",
        voiceKind: selection === "original" ? "original" : "future",
        futureVoiceId: selection === "original" ? state.profile.future_voice_id : nextVoiceId,
        futureTargetAccent: selection === "original" ? state.profile.future_target_accent : ($("remix-target-accent").value === "modern_british" ? "modern_british" : "general_american"),
        futureStrength: selection === "original" ? state.profile.future_strength : selection,
      });
      if (actionGeneration !== state.actionGeneration) return;
      setProgress("voice-remix-status", connected ? "ready" : "error", connected
        ? (selection === "original" ? "Your original voice is connected. No clone was replaced." : "Your chosen Future Me voice is saved and connected. The original clone is still preserved.")
        : "The voice was saved, but it could not be connected to the video coach yet. Reopen setup to retry.");
    } catch (error) {
      setProgress("voice-remix-status", "error", `${error.message} Your original clone is unchanged.`);
    } finally {
      state.remixSaving = false;
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

  async function createPal(faceOverride = "", voiceOverride = "", {
    useFace = state.path !== "voice",
    voiceKind = "",
    futureVoiceId = "",
    futureTargetAccent = "",
    futureStrength = "",
    clearFuture = false,
  } = {}) {
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
      const nextVoiceKind = voiceKind === "future" ? "future" : voiceKind === "original" ? "original" : state.profile.voice_kind;
      saveProfile({
        ...state.profile,
        face_id: useFace ? nextFaceId : "",
        voice_id: nextVoiceId,
        pal_id: result.pal_id,
        voice_kind: nextVoiceKind,
        future_voice_id: clearFuture ? "" : (safeId(futureVoiceId) || state.profile.future_voice_id),
        future_target_accent: clearFuture ? "" : (safeTargetAccent(futureTargetAccent) || state.profile.future_target_accent),
        future_strength: clearFuture ? "" : (safeRemixStrength(futureStrength) || state.profile.future_strength),
      });
      if (faceOverride) {
        state.pendingFaceId = "";
        state.pendingFaceStartedAt = 0;
        state.pendingFacePath = "";
      }
      if (voiceOverride) {
        state.pendingVoiceId = "";
        state.pendingVoiceKind = "";
        state.pendingVoiceTargetAccent = "";
        state.pendingVoiceStrength = "";
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
  $("remix-consent-checkbox").addEventListener("change", updateButtons);
  document.querySelectorAll('input[name="personalization-path"]').forEach(input => input.addEventListener("change", updatePersonalizationPath));
  $("training-url").addEventListener("input", updateButtons);
  $("existing-face-id").addEventListener("input", updateButtons);
  $("setup-record-button").addEventListener("click", () => { void startFaceRecording(); });
  $("setup-stop-button").addEventListener("click", stopFaceRecording);
  $("voice-record-button").addEventListener("click", () => { void startVoiceRecording(); });
  $("voice-stop-button").addEventListener("click", stopVoiceRecording);
  $("clone-voice-button").addEventListener("click", () => { void createVoiceClone(); });
  $("generate-remix-button").addEventListener("click", () => { void generateRemixPreviews(); });
  $("connect-remix-button").addEventListener("click", () => { void connectRemixChoice(); });
  $("remix-target-accent").addEventListener("change", () => {
    resetRemixPreviews("Accent changed. Generate new Subtle and Balanced previews.");
  });
  document.querySelectorAll('input[name="voice-remix-choice"]').forEach(input => input.addEventListener("change", updateRemixChoice));
  $("create-face-button").addEventListener("click", () => { void submitFace(); });
  $("use-existing-face-button").addEventListener("click", () => { void useExistingFace(); });
  $("retry-pal-button").addEventListener("click", () => {
    if (!state.pendingVoiceId) return;
    const pendingKind = state.pendingVoiceKind === "future" ? "future" : "original";
    void createPal(state.profile.face_id, state.pendingVoiceId, {
      voiceKind: pendingKind,
      futureVoiceId: pendingKind === "future" ? state.pendingVoiceId : state.profile.future_voice_id,
      futureTargetAccent: pendingKind === "future" ? state.pendingVoiceTargetAccent : state.profile.future_target_accent,
      futureStrength: pendingKind === "future" ? state.pendingVoiceStrength : state.profile.future_strength,
      clearFuture: pendingKind === "original",
    });
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
    state.remixSubmitting = false;
    state.remixSaving = false;
    state.pendingFaceId = "";
    state.pendingFaceStartedAt = 0;
    state.pendingFacePath = "";
    state.pendingVoiceId = "";
    state.pendingVoiceKind = "";
    state.pendingVoiceTargetAccent = "";
    state.pendingVoiceStrength = "";
    state.voiceVerificationRequired = false;
    saveOriginalVoiceId("");
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
  if (state.profile.future_target_accent) $("remix-target-accent").value = state.profile.future_target_accent;
  if (state.originalVoiceId) saveOriginalVoiceId(state.originalVoiceId);
  renderProfile();
  if (state.pendingFaceId) startFacePolling(state.pendingFaceId);
})();
