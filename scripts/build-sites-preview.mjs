import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(join(root, relative));

const html = (await read("server/pages/live.html")).toString("utf8");
const css = (await read("server/static/live.css")).toString("utf8");
const js = (await read("server/static/live.js")).toString("utf8");
const dailyJs = (await read("server/static/daily-0.91.0.js")).toString("utf8");
const og = (await read("server/static/og-personal-coach.png")).toString("base64");

const worker = `
const HTML = ${JSON.stringify(html)};
const CSS = ${JSON.stringify(css)};
const JS = ${JSON.stringify(js)};
const DAILY_JS = ${JSON.stringify(dailyJs)};
const OG_BASE64 = ${JSON.stringify(og)};
const TAVUS_BASE = "https://tavusapi.com/v2";
const DEFAULT_FACE_ID = "r987f6e6f73c"; // Nathan - Bookshelf, account-available Phoenix-4 stock Face
const PAL_NAME = "Fluent Me Conversation Coach v4";

const PAL_PROMPT = ${JSON.stringify(`You are the visible personal English coach inside Fluent Me. This is a live, learner-led conversation, not a scripted lesson. Respond to what the learner means first. Keep most replies to one to three natural spoken sentences and ask at most one useful follow-up. The learner may change topics, interrupt, or ask a direct question at any time. Never wait for an app-controlled step and never force a curriculum sequence.

When the learner asks "How did I sound?", give exactly one specific English observation and one more natural version of their last completed thought. Do not give a numeric score or a wall of metrics. When they ask you to say something naturally, speak the improved version clearly and invite them to try it. Exact model phrases may arrive through conversation.echo; say those exactly.

When the learner asks about emotion, presence, or how they are coming across, use only observable signals that were actually available in the current turn: words, pace, pauses, clarity, vocal tone, and visible delivery cues only when camera input exists. Cite the cue, state uncertainty, and ask whether the impression matches their experience. Never claim to know an inner emotion, diagnose a mental state, or infer ability, personality, or protected traits. If evidence is weak or a modality is unavailable, say so plainly.

Be warm, direct, curious, and appropriate for an intermediate English learner. You are an AI English coach, not a human, therapist, examiner, or hiring evaluator.`)};

const CONVERSATION_CONTEXT = ${JSON.stringify(`You are meeting an intermediate English learner in an open, face-to-face conversation. The learner controls the topic and may speak naturally, ask for feedback on the last turn, ask how their delivery came across, or request an exact phrase model at any point. Respond to the current request rather than following a lesson sequence. Keep coaching specific, brief, and immediately usable.`)};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
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

async function ensurePal(env) {
  // Only a dedicated v4 override may skip creation. An older scripted PAL
  // must not silently replace this conversation-first behavior.
  const configured = String(env.TAVUS_CONVERSATION_PAL_ID || "").trim();
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

async function createConversation(request, env) {
  if (!String(env.TAVUS_API_KEY || "").trim()) {
    return json({ error: "Live coaching is unavailable right now.", reason: "not_configured" }, 503);
  }
  try {
    const palId = await ensurePal(env);
    const faceId = String(env.TAVUS_FACE_ID || DEFAULT_FACE_ID).trim();
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
    const message = safeStatus === 429
      ? "Your coach is busy right now. Try again shortly."
      : "I couldn't bring your coach into the conversation. Try again.";
    return json({ error: message, reason: "tavus" }, safeStatus);
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
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, { headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/static/live.css") {
      return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/static/live.js") {
      return new Response(JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
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
        pal_ready: Boolean(String(env.TAVUS_CONVERSATION_PAL_ID || "").trim()),
        capabilities: { face: "Phoenix", perception: "Raven-1", turn_taking: "Sparrow-1", emotion_recognition: "limited" },
      });
    }
    if (url.pathname === "/api/tavus/conversations" && request.method === "POST") {
      return createConversation(request, env);
    }
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
