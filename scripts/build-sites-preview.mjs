import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(join(root, relative));

const html = (await read("server/pages/live.html")).toString("utf8");
const css = (await read("server/static/live.css")).toString("utf8");
const js = (await read("server/static/live.js")).toString("utf8");
const personalizeJs = (await read("server/static/personalize.js")).toString("utf8");
const dailyJs = (await read("server/static/daily-0.91.0.js")).toString("utf8");
const og = (await read("server/static/og-personal-coach.png")).toString("base64");

const worker = `
const HTML = ${JSON.stringify(html)};
const CSS = ${JSON.stringify(css)};
const JS = ${JSON.stringify(js)};
const PERSONALIZE_JS = ${JSON.stringify(personalizeJs)};
const DAILY_JS = ${JSON.stringify(dailyJs)};
const OG_BASE64 = ${JSON.stringify(og)};
const TAVUS_BASE = "https://tavusapi.com/v2";
const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_FACE_ID = "r987f6e6f73c"; // Nathan - Bookshelf, account-available Phoenix-4 stock Face
const PAL_NAME = "Fluent Me Conversation Coach v5";
const SAFE_ID = /^[A-Za-z0-9_-]{6,128}$/;

const PAL_PROMPT = ${JSON.stringify(`You are the visible personal English coach inside Fluent Me. This is a live, learner-led conversation, not a scripted lesson. Respond to what the learner means first. Keep most replies to one to three natural spoken sentences and ask at most one useful follow-up. The learner may change topics, interrupt, or ask a direct question at any time. Never wait for an app-controlled step and never force a curriculum sequence.

When the learner asks "How did I sound?", give exactly one specific English observation and one more natural version of their last completed thought. Do not give a numeric score or a wall of metrics. When they ask you to say something naturally, speak the improved version clearly and invite them to try it. Exact model phrases may arrive through conversation.echo; say those exactly.

The product can ask you to compare two attempts of the same phrase. Compare only the evidence provided for those attempts. Name one concrete improvement first, then one next detail to practice, and finish by speaking the strongest version once. Never invent an attempt, a signal, or a numeric score. If either attempt is missing, say what is missing instead of pretending to compare it.

When the learner asks to wrap up, give a compact session reflection with exactly three parts: one thing they communicated well, one useful natural phrase from the conversation, and one specific thing to practice next. Ground every part in the conversation that actually happened.

When the learner asks about emotion, presence, or how they are coming across, use only observable signals that were actually available in the current turn: words, pace, pauses, clarity, vocal tone, and visible delivery cues only when camera input exists. Cite the cue, state uncertainty, and ask whether the impression matches their experience. Never claim to know an inner emotion, diagnose a mental state, or infer ability, personality, or protected traits. If evidence is weak or a modality is unavailable, say so plainly.

Be warm, direct, curious, and appropriate for an intermediate English learner. You are an AI English coach, not a human, therapist, examiner, or hiring evaluator.`)};

const CONVERSATION_CONTEXT = ${JSON.stringify(`You are meeting an intermediate English learner in an open, face-to-face conversation. The learner controls the topic and may speak naturally, ask for feedback on the last turn, ask how their delivery came across, or request an exact phrase model at any point. Respond to the current request rather than following a lesson sequence. Keep coaching specific, brief, and immediately usable.`)};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(self), geolocation=()",
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const imageResponse = (base64, type = "image/png") => {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
};

async function tavusRequest(env, path, options = {}) {
  const key = String(env.TAVUS_API_KEY || "").trim();
  if (!key) throw Object.assign(new Error("Live coaching is unavailable right now."), { status: 503 });
  const response = await fetch(TAVUS_BASE + path, {
    method: options.method || "GET",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "x-api-key": key,
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error || "Tavus request failed.";
    throw Object.assign(new Error(String(message).slice(0, 240)), { status: response.status });
  }
  return payload;
}

async function elevenRequest(env, path, options = {}) {
  const key = String(env.ELEVENLABS_API_KEY || "").trim();
  if (!key) throw Object.assign(new Error("ElevenLabs is not configured for this coach."), { status: 503 });
  const headers = { "accept": "application/json", "xi-api-key": key, ...(options.headers || {}) };
  const response = await fetch(ELEVEN_BASE + path, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.detail?.message || payload.detail || payload.message || payload.error || "ElevenLabs request failed.";
    throw Object.assign(new Error(String(detail).slice(0, 240)), { status: response.status });
  }
  return payload;
}

function safeProviderError(error, provider) {
  const status = Number(error?.status) || 502;
  const safeStatus = status >= 400 && status < 600 ? status : 502;
  let message = provider === "elevenlabs"
    ? "ElevenLabs could not complete that request."
    : "Tavus could not complete that request.";
  if (safeStatus === 401 || safeStatus === 403) message = provider === "elevenlabs"
    ? "ElevenLabs rejected the server credential. Add a current API key and try again."
    : "Tavus rejected the server credential. Rotate the key and try again.";
  if (safeStatus === 402) message = provider === "elevenlabs"
    ? "This ElevenLabs account needs an active cloning plan or grant credits."
    : "This Tavus account needs more credits before training can start.";
  if (safeStatus === 429) message = (provider === "elevenlabs" ? "ElevenLabs" : "Tavus") + " is busy or rate-limited. Try again shortly.";
  return json({ error: message, reason: provider }, safeStatus);
}

function cleanName(value, fallback) {
  const cleaned = String(value || "").replace(/[\\u0000-\\u001f\\u007f]/g, "").trim().slice(0, 80);
  return cleaned || fallback;
}

function validId(value) {
  const cleaned = String(value || "").trim();
  return SAFE_ID.test(cleaned) ? cleaned : "";
}

function publicHttpsUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); }
  catch { return ""; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
  const host = parsed.hostname.replace(/^\\[|\\]$/g, "").replace(/\\.$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return "";
  if (host.includes(":")) return "";
  const match = host.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
  if (match) {
    const octets = match.slice(1).map(Number);
    if (octets.some(part => part > 255)) return "";
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))) return "";
  }
  return parsed.toString();
}

async function ensurePal(env) {
  // Only a dedicated v5 override may skip creation. An older scripted PAL
  // must not silently replace this conversation-first behavior.
  const configured = String(env.TAVUS_CONVERSATION_PAL_V5_ID || "").trim();
  if (configured) return configured;

  const listed = await tavusRequest(env, "/pals?limit=100");
  const pals = listed.data || listed.pals || [];
  const existing = pals.find(pal => pal.pal_name === PAL_NAME && pal.pal_id);
  if (existing) return existing.pal_id;

  const faceId = String(env.TAVUS_FACE_ID || DEFAULT_FACE_ID).trim();
  const created = await tavusRequest(env, "/pals", {
    method: "POST",
    body: {
      pal_name: PAL_NAME,
      pipeline_mode: "full",
      system_prompt: PAL_PROMPT,
      default_face_id: faceId,
      disclosure_type: "always",
      verbal_disclosure: "Just so you know, you're speaking with an AI English coach.",
      visual_disclosure: "You are speaking with an AI English coach.",
      layers: {
        perception: {
          perception_model: "raven-1",
          emotion_recognition: "limited",
          visual_awareness_queries: [
            "Describe only observable delivery cues relevant to this turn, such as gaze direction, posture, gesture, or visible expression changes. Do not label an inner emotion.",
            "What visible object, screen, or activity is directly relevant to what the learner is saying?",
          ],
          audio_awareness_queries: [
            "Describe only observable vocal delivery in this turn: pace, pauses, clarity, energy, volume changes, and background noise. Do not diagnose an inner emotion.",
          ],
          perception_analysis_queries: [
            "Summarize observable delivery changes across the session, cite evidence, and preserve uncertainty without inferring emotion or ability.",
          ],
        },
        conversational_flow: {
          turn_detection_model: "sparrow-1",
          turn_taking_patience: "medium",
          pal_interruptibility: "high",
          voice_isolation: "near",
        },
      },
    },
  });
  if (!created.pal_id) throw Object.assign(new Error("Tavus created no usable PAL."), { status: 502 });
  return created.pal_id;
}

async function personalizationStatus(env) {
  const elevenConfigured = Boolean(String(env.ELEVENLABS_API_KEY || "").trim());
  const tavusConfigured = Boolean(String(env.TAVUS_API_KEY || "").trim());
  if (!elevenConfigured) {
    return json({
      elevenlabs: { configured: false },
      tavus: { configured: tavusConfigured },
    });
  }
  try {
    const value = await elevenRequest(env, "/user/subscription");
    return json({
      elevenlabs: {
        configured: true,
        tier: String(value.tier || "unknown"),
        status: String(value.status || "unknown"),
        character_count: Number(value.character_count) || 0,
        character_limit: Number(value.character_limit) || 0,
        voice_slots_used: Number(value.voice_slots_used) || 0,
        voice_limit: Number(value.voice_limit) || 0,
        can_use_instant_voice_cloning: Boolean(value.can_use_instant_voice_cloning),
        next_character_count_reset_unix: Number(value.next_character_count_reset_unix) || null,
      },
      tavus: { configured: tavusConfigured },
    });
  } catch (error) {
    return safeProviderError(error, "elevenlabs");
  }
}

async function createVoiceClone(request, env) {
  try {
    const input = await request.formData();
    const consent = String(input.get("consent") || "").toLowerCase() === "true";
    const audio = input.get("audio");
    if (!consent) return json({ error: "Confirm that this is your voice and that you consent to cloning it.", reason: "consent" }, 400);
    if (!audio || typeof audio.arrayBuffer !== "function") return json({ error: "Record a voice sample before creating a clone.", reason: "audio" }, 400);
    if (audio.size < 1000 || audio.size > 20 * 1024 * 1024) return json({ error: "Voice samples must be between 1 KB and 20 MB.", reason: "audio" }, 400);
    const outbound = new FormData();
    outbound.append("name", cleanName(input.get("name"), "Fluent Me personal voice"));
    outbound.append("description", "Consent-confirmed personal voice for the owner's Fluent Me English coach.");
    outbound.append("remove_background_noise", "false");
    outbound.append("files", audio, audio.name || "fluent-me-voice.webm");
    const result = await elevenRequest(env, "/voices/add", { method: "POST", body: outbound });
    const voiceId = validId(result.voice_id);
    if (!voiceId) throw Object.assign(new Error("ElevenLabs returned no usable voice identifier."), { status: 502 });
    return json({ voice_id: voiceId, requires_verification: Boolean(result.requires_verification) });
  } catch (error) {
    return safeProviderError(error, "elevenlabs");
  }
}

async function createPersonalPal(request, env) {
  try {
    const body = await request.json().catch(() => ({}));
    const voiceId = validId(body.voice_id);
    const faceId = validId(body.face_id) || String(env.TAVUS_FACE_ID || DEFAULT_FACE_ID).trim();
    if (!voiceId) return json({ error: "A valid cloned voice is required.", reason: "voice" }, 400);
    if (!String(env.ELEVENLABS_API_KEY || "").trim()) return json({ error: "ElevenLabs is not configured for this coach.", reason: "not_configured" }, 503);
    const created = await tavusRequest(env, "/pals", {
      method: "POST",
      body: {
        pal_name: "Fluent Me Personal Coach " + Date.now(),
        pipeline_mode: "full",
        system_prompt: PAL_PROMPT,
        default_face_id: faceId,
        disclosure_type: "always",
        verbal_disclosure: "Just so you know, you're speaking with an AI English coach using a consented cloned voice.",
        visual_disclosure: "You are speaking with an AI English coach.",
        layers: {
          perception: {
            perception_model: "raven-1",
            emotion_recognition: "limited",
            visual_awareness_queries: ["Describe only observable delivery cues relevant to this turn. Do not label an inner emotion."],
            audio_awareness_queries: ["Describe only observable vocal delivery: pace, pauses, clarity, energy, volume changes, and background noise."],
          },
          conversational_flow: {
            turn_detection_model: "sparrow-1",
            turn_taking_patience: "medium",
            pal_interruptibility: "high",
            voice_isolation: "near",
          },
          tts: {
            tts_engine: "elevenlabs",
            api_key: String(env.ELEVENLABS_API_KEY),
            external_voice_id: voiceId,
            tts_model_name: "eleven_flash_v2_5",
            tts_emotion_control: true,
            voice_settings: { speed: 0.94, stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
          },
        },
      },
    });
    const palId = validId(created.pal_id);
    if (!palId) throw Object.assign(new Error("Tavus returned no usable PAL identifier."), { status: 502 });
    return json({ pal_id: palId });
  } catch (error) {
    return safeProviderError(error, "tavus");
  }
}

async function createPersonalFace(request, env) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.consent !== true) return json({ error: "Confirm that you own this likeness and consent to training before continuing.", reason: "consent" }, 400);
    const trainingUrl = publicHttpsUrl(body.train_video_url);
    if (!trainingUrl) return json({ error: "Enter a public HTTPS training-video URL without embedded credentials.", reason: "url" }, 400);
    const created = await tavusRequest(env, "/faces", {
      method: "POST",
      body: {
        face_name: cleanName(body.face_name, "Fluent Me personal face"),
        train_video_url: trainingUrl,
        model_name: "phoenix-4",
      },
    });
    const faceId = validId(created.face_id);
    if (!faceId) throw Object.assign(new Error("Tavus returned no usable face identifier."), { status: 502 });
    return json({ face_id: faceId, status: String(created.status || "started") });
  } catch (error) {
    return safeProviderError(error, "tavus");
  }
}

async function getPersonalFace(faceId, env) {
  const safeFaceId = validId(faceId);
  if (!safeFaceId) return json({ error: "Invalid face identifier.", reason: "face" }, 400);
  try {
    const face = await tavusRequest(env, "/faces/" + encodeURIComponent(safeFaceId));
    return json({
      face_id: safeFaceId,
      status: String(face.status || face.training_status || "unknown"),
      face_name: String(face.face_name || ""),
      error: face.error_message || face.error_details
        ? String(face.error_message || face.error_details).slice(0, 240)
        : null,
    });
  } catch (error) {
    return safeProviderError(error, "tavus");
  }
}

async function createConversation(request, env) {
  if (!String(env.TAVUS_API_KEY || "").trim()) {
    return json({ error: "Live coaching is unavailable right now.", reason: "not_configured" }, 503);
  }
  try {
    const body = await request.json().catch(() => ({}));
    const personalPalId = validId(body.pal_id);
    const personalFaceId = validId(body.face_id);
    const palId = personalPalId || await ensurePal(env);
    const faceId = personalFaceId || String(env.TAVUS_FACE_ID || DEFAULT_FACE_ID).trim();
    const result = await tavusRequest(env, "/conversations", {
      method: "POST",
      body: {
        pal_id: palId,
        // Explicitly override an older PAL's default Face for every room.
        face_id: faceId,
        conversation_name: "Fluent Me · Open English conversation",
        conversational_context: CONVERSATION_CONTEXT,
        custom_greeting: "Hey, I'm your personal English coach. What do you feel like talking about today? You can also ask how you sound or ask me to model any phrase.",
        require_auth: true,
        max_participants: 2,
        audio_only: false,
        properties: {
          participant_absent_timeout: 60,
          participant_left_timeout: 15,
          max_call_duration: 900,
        },
      },
    });
    const required = ["conversation_id", "conversation_url", "meeting_token"];
    if (required.some(key => !result[key])) throw Object.assign(new Error("Tavus returned an incomplete private room."), { status: 502 });
    console.log(JSON.stringify({ event: "conversation.created", conversation_id: result.conversation_id }));
    return json({
      conversation_id: result.conversation_id,
      conversation_url: result.conversation_url,
      meeting_token: result.meeting_token,
      status: result.status || "active",
    });
  } catch (error) {
    const status = Number(error.status) || 502;
    const safeStatus = status >= 400 && status < 600 ? status : 502;
    const message = safeStatus === 402
      ? "This coach needs more Tavus conversation minutes before a new session can start."
      : safeStatus === 429
        ? "Your coach is busy right now. Try again shortly."
        : "I couldn't bring your coach into the conversation. Try again.";
    const reason = safeStatus === 402 ? "credits" : safeStatus === 429 ? "capacity" : "tavus";
    return json({ error: message, reason }, safeStatus);
  }
}

async function endConversation(conversationId, env) {
  if (!String(env.TAVUS_API_KEY || "").trim()) return json({ status: "not_configured" });
  try {
    await tavusRequest(env, "/conversations/" + encodeURIComponent(conversationId) + "/end", { method: "POST" });
    console.log(JSON.stringify({ event: "conversation.ended", conversation_id: conversationId }));
    return json({ status: "ended" });
  } catch (error) {
    return json({ error: error.message || "Could not end the Tavus room." }, Number(error.status) || 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.startsWith("/api/")) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return json({ error: "Cross-origin requests are not allowed." }, 403);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, { headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/static/live.css") {
      return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/static/live.js") {
      return new Response(JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/static/personalize.js") {
      return new Response(PERSONALIZE_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/static/daily-0.91.0.js") {
      return new Response(DAILY_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" } });
    }
    if (url.pathname === "/static/og-personal-coach.png") return imageResponse(OG_BASE64);
    if (url.pathname === "/api/tavus/status") {
      const configured = Boolean(String(env.TAVUS_API_KEY || "").trim());
      return json({
        configured,
        has_key: configured,
        mode: configured ? "tavus_live" : "tavus_required",
        experience_mode: configured ? "tavus_live" : "tavus_required",
        pal_ready: Boolean(String(env.TAVUS_CONVERSATION_PAL_V5_ID || "").trim()),
        capabilities: { face: "Phoenix", perception: "Raven-1", turn_taking: "Sparrow-1", emotion_recognition: "limited" },
      });
    }
    if (url.pathname === "/api/tavus/conversations" && request.method === "POST") {
      return createConversation(request, env);
    }
    if (url.pathname === "/api/personalization/status" && request.method === "GET") {
      return personalizationStatus(env);
    }
    if (url.pathname === "/api/personalization/voice" && request.method === "POST") {
      return createVoiceClone(request, env);
    }
    if (url.pathname === "/api/personalization/pal" && request.method === "POST") {
      return createPersonalPal(request, env);
    }
    if (url.pathname === "/api/personalization/face" && request.method === "POST") {
      return createPersonalFace(request, env);
    }
    const faceMatch = url.pathname.match(/^\\/api\\/personalization\\/face\\/([^/]+)$/);
    if (faceMatch && request.method === "GET") return getPersonalFace(decodeURIComponent(faceMatch[1]), env);
    const endMatch = url.pathname.match(/^\\/api\\/tavus\\/conversations\\/([^/]+)\\/end$/);
    if (endMatch && request.method === "POST") return endConversation(decodeURIComponent(endMatch[1]), env);
    return new Response("Not found", { status: 404 });
  },
};
`;

const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "server"), { recursive: true });
await writeFile(join(dist, "server", "index.js"), worker, "utf8");

try {
  const hosting = await read(".openai/hosting.json");
  await mkdir(join(dist, ".openai"), { recursive: true });
  await writeFile(join(dist, ".openai", "hosting.json"), hosting);
} catch {
  // The first build may run before Sites assigns this project an id.
}

console.log("Built Fluent Me open conversation coach.");
