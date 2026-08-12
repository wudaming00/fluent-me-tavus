import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(join(root, relative));

const html = (await read("server/pages/live.html")).toString("utf8");
const css = (await read("server/static/live.css")).toString("utf8");
const js = (await read("server/static/live.js")).toString("utf8");
const dailyJs = (await read("server/static/daily-0.91.0.js")).toString("utf8");
const og = (await read("server/static/og-language-lesson.png")).toString("base64");

const worker = `
const HTML = ${JSON.stringify(html)};
const CSS = ${JSON.stringify(css)};
const JS = ${JSON.stringify(js)};
const DAILY_JS = ${JSON.stringify(dailyJs)};
const OG_BASE64 = ${JSON.stringify(og)};
const TAVUS_BASE = "https://tavusapi.com/v2";
const DEFAULT_FACE_ID = "r90bbd427f71";
const PAL_NAME = "Fluent Me Language Coach v3";

const PAL_PROMPT = ${JSON.stringify(`You are the visible English coach inside Fluent Me, a five-step speaking lesson.

The Fluent Me interface owns the lesson sequence: Listen, Repeat, Fix, Recall, and Use. Never advance the lesson yourself and never give numeric scores. The app may send exact model sentences through conversation.echo. Speak those sentences exactly and naturally.

When the learner repeats or recalls a sentence, acknowledge its meaning in at most one short sentence, then wait. Do not interrupt. During the Use step, ask or answer one natural follow-up so the new expression enters a real conversation. Keep every turn short, warm, spoken-first, and appropriate for an intermediate English learner.

Raven observations are uncertain context only. Never infer ability, personality, protected traits, or mental state from perception. You are an AI English coach, not a human and not an examiner.`)};

const LESSON_CONTEXT = ${JSON.stringify(`Today's three target phrases are:
1. Tavus is more than a digital face.
2. The face is the interface; the real product is the system behind it.
3. It combines perception, memory, and orchestration to make conversations feel responsive.

The learner is preparing to explain Tavus in an interview. The app controls exact demonstrations and the learner's current step. Keep spontaneous replies brief so they do not compete with the lesson UI.`)};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(self), geolocation=()",
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
  if (!key) throw Object.assign(new Error("Tavus live video is not configured on this deployment."), { status: 503 });
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
  const configured = String(env.TAVUS_PAL_ID || "").trim();
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
          visual_awareness_queries: ["What visible object or screen content is directly relevant to this language practice?"],
          audio_awareness_queries: ["Is background noise making the learner difficult to hear? Describe only observable audio conditions."],
        },
        conversational_flow: {
          turn_detection_model: "sparrow-1",
          turn_taking_patience: "high",
          pal_interruptibility: "high",
        },
      },
    },
  });
  if (!created.pal_id) throw Object.assign(new Error("Tavus created no usable PAL."), { status: 502 });
  return created.pal_id;
}

async function createConversation(request, env) {
  if (!String(env.TAVUS_API_KEY || "").trim()) {
    return json({ error: "Tavus live video is not configured on this deployment.", reason: "not_configured" }, 503);
  }
  try {
    const palId = await ensurePal(env);
    const result = await tavusRequest(env, "/conversations", {
      method: "POST",
      body: {
        pal_id: palId,
        conversation_name: "Fluent Me · Tavus interview English",
        conversational_context: LESSON_CONTEXT,
        custom_greeting: "Tavus is more than a digital face.",
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
    return json({
      conversation_id: result.conversation_id,
      conversation_url: result.conversation_url,
      meeting_token: result.meeting_token,
      status: result.status || "active",
    });
  } catch (error) {
    const status = Number(error.status) || 502;
    const safeStatus = status >= 400 && status < 600 ? status : 502;
    const message = safeStatus === 401 || safeStatus === 403
      ? "Tavus rejected the server credential. Rotate it and reconnect."
      : error.message || "Could not create the Tavus room.";
    return json({ error: message, reason: "tavus" }, safeStatus);
  }
}

async function endConversation(conversationId, env) {
  if (!String(env.TAVUS_API_KEY || "").trim()) return json({ status: "not_configured" });
  try {
    await tavusRequest(env, "/conversations/" + encodeURIComponent(conversationId) + "/end", { method: "POST" });
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
    if (url.pathname === "/static/og-language-lesson.png") return imageResponse(OG_BASE64);
    if (url.pathname === "/api/tavus/status") {
      const configured = Boolean(String(env.TAVUS_API_KEY || "").trim());
      return json({
        configured,
        has_key: configured,
        mode: configured ? "tavus_live" : "tavus_required",
        experience_mode: configured ? "tavus_live" : "tavus_required",
        pal_ready: Boolean(String(env.TAVUS_PAL_ID || "").trim()),
        capabilities: { face: "Phoenix", perception: "Raven-1", turn_taking: "Sparrow-1" },
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

console.log("Built Fluent Me face-to-face language lesson.");
