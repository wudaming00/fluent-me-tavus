import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(join(root, relative));

let html = (await read("server/pages/live.html")).toString("utf8");
const css = (await read("server/static/live.css")).toString("utf8");
const js = (await read("server/static/live.js")).toString("utf8");
const og = (await read("server/static/og-v2.png")).toString("base64");

// The hosted artifact remains genuinely useful without server credentials: the
// browser practice loop records speech locally, transcribes it when supported,
// analyzes observable answer evidence, and persists the latest practice on the
// device. A server deployment upgrades the same UI to Tavus live video.
html = html
  .replaceAll('href="/studio"', 'href="#mirror-card"')
  .replaceAll('href="/progress"', 'href="#report-card"');

const worker = `
const HTML = ${JSON.stringify(html)};
const CSS = ${JSON.stringify(css)};
const JS = ${JSON.stringify(js)};
const OG_BASE64 = ${JSON.stringify(og)};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/static/live.css") {
      return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (url.pathname === "/static/live.js") {
      return new Response(JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (url.pathname === "/static/og-v2.png") {
      const raw = atob(OG_BASE64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    if (url.pathname === "/api/tavus/status") {
      return json({
        configured: false,
        mode: "browser_practice",
        experience_mode: "browser_practice",
        pal_ready: false,
        mirror_voice_ready: false,
        capabilities: { face: "Phoenix", perception: "Raven-1", turn_taking: "Sparrow-1", emotion_recognition: "limited_on_managed_pal" },
      });
    }
    if (url.pathname === "/api/cards") {
      return json({ now: Math.floor(Date.now() / 1000), cards: [] });
    }
    if (url.pathname.startsWith("/api/tavus/conversations")) {
      return json({ error: "Live video is not configured in this environment.", reason: "not_configured" }, 503);
    }
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

console.log("Built Fluent Me speaking practice.");
