import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


const source = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
const encoded = Buffer.from(source).toString("base64");
const { default: worker } = await import(`data:text/javascript;base64,${encoded}`);

const responseJson = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

for (const [label, faceId, expected] of [
  ["Nathan by default", undefined, "r987f6e6f73c"],
  ["an environment override", "face-custom-male", "face-custom-male"],
]) {
  test(`Sites Worker uses ${label} with an existing PAL`, async () => {
    const originalFetch = globalThis.fetch;
    let conversationBody;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/pals?limit=100")) {
        return responseJson({
          data: [{ pal_name: "Fluent Me Conversation Coach v6", pal_id: "pal-existing" }],
        });
      }
      if (String(url).endsWith("/conversations")) {
        conversationBody = JSON.parse(options.body);
        return responseJson({
          conversation_id: "c-live",
          conversation_url: "https://tavus.daily.co/c-live",
          meeting_token: "short-lived-token",
        });
      }
      throw new Error(`Unexpected Tavus request: ${url}`);
    };

    try {
      const env = { TAVUS_API_KEY: "server-secret" };
      if (faceId) env.TAVUS_FACE_ID = faceId;
      const response = await worker.fetch(new Request(
        "https://fluent-me.test/api/tavus/conversations",
        { method: "POST" },
      ), env);

      assert.equal(response.status, 200);
      assert.equal(conversationBody.pal_id, "pal-existing");
      assert.equal(conversationBody.face_id, expected);
      assert.equal(conversationBody.conversation_name, "Fluent Me · Open English conversation");
      assert.match(conversationBody.custom_greeting, /personal English coach/);
      assert.match(conversationBody.custom_greeting, /feel like talking about today/);
      assert.match(conversationBody.conversational_context, /learner controls the topic/);
      assert.doesNotMatch(conversationBody.custom_greeting, /Tavus|digital face/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("Sites Worker enables explicit microphone and optional camera access", async () => {
  const response = await worker.fetch(new Request("https://fluent-me.test/"), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("permissions-policy"), "camera=(self), microphone=(self), geolocation=()");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'");
  const html = await response.text();
  assert.match(html, /Start video conversation/);
  assert.doesNotMatch(html, /Step 1 of 5|Hear the model/);
});

test("Sites Worker serves the deterministic speaking-evidence module", async () => {
  const response = await worker.fetch(new Request("https://fluent-me.test/static/analysis-core.js"), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/javascript/);
  const javascript = await response.text();
  assert.match(javascript, /summarizeTurn/);
  assert.match(javascript, /phonemes: false/);
});

test("Sites Worker constrains the live video row instead of letting the coach console stretch it", async () => {
  const response = await worker.fetch(new Request("https://fluent-me.test/static/live.css"), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/css/);
  const css = await response.text();
  assert.match(css, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.coach-console\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.daily-stage video\s*\{[^}]*object-fit:\s*contain[^}]*object-position:\s*50% 50%/s);
  assert.match(css, /@media\s*\(max-width:\s*840px\)[\s\S]*?\.conversation-grid\s*\{[^}]*grid-template-rows:\s*auto auto/);
});

test("Sites Worker does not reuse the old scripted v3 PAL", async () => {
  const originalFetch = globalThis.fetch;
  let createdPal;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/pals?limit=100")) {
      return responseJson({ data: [{ pal_name: "Fluent Me Language Coach v3", pal_id: "pal-v3" }] });
    }
    if (String(url).endsWith("/pals")) {
      createdPal = JSON.parse(options.body);
      return responseJson({ pal_id: "pal-v6" });
    }
    if (String(url).endsWith("/conversations")) {
      const body = JSON.parse(options.body);
      assert.equal(body.pal_id, "pal-v6");
      return responseJson({
        conversation_id: "c-v6",
        conversation_url: "https://tavus.daily.co/c-v6",
        meeting_token: "short-lived-token",
      });
    }
    throw new Error(`Unexpected Tavus request: ${url}`);
  };

  try {
    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/tavus/conversations",
      { method: "POST" },
    ), { TAVUS_API_KEY: "server-secret" });
    assert.equal(response.status, 200);
    assert.equal(createdPal.pal_name, "Fluent Me Conversation Coach v6");
    assert.match(createdPal.system_prompt, /learner-led conversation/);
    assert.match(createdPal.system_prompt, /compare two attempts/);
    assert.match(createdPal.system_prompt, /compact session reflection/);
    assert.equal(createdPal.layers.perception.emotion_recognition, "limited");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker returns an actionable Tavus credit error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/pals?limit=100")) {
      return responseJson({ data: [{ pal_name: "Fluent Me Conversation Coach v6", pal_id: "pal-existing" }] });
    }
    if (String(url).endsWith("/conversations")) {
      return new Response(JSON.stringify({ message: "payment required" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected Tavus request: ${url}`);
  };

  try {
    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/tavus/conversations",
      { method: "POST" },
    ), { TAVUS_API_KEY: "server-secret" });
    const body = await response.json();
    assert.equal(response.status, 402);
    assert.equal(body.reason, "credits");
    assert.match(body.error, /conversation minutes/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker rejects cross-origin mutation requests", async () => {
  const response = await worker.fetch(new Request(
    "https://fluent-me.test/api/tavus/conversations",
    {
      method: "POST",
      headers: { origin: "https://malicious.example", "content-type": "text/plain" },
      body: "{}",
    },
  ), { TAVUS_API_KEY: "server-secret" });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Cross-origin/);
});

test("Sites Worker reports sanitized ElevenLabs subscription usage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.elevenlabs.io/v1/user/subscription");
    assert.equal(options.headers["xi-api-key"], "eleven-secret");
    return responseJson({
      tier: "starter",
      status: "active",
      character_count: 1200,
      character_limit: 30000,
      voice_slots_used: 1,
      voice_limit: 10,
      can_use_instant_voice_cloning: true,
      private_account_field: "must-not-leak",
    });
  };
  try {
    const response = await worker.fetch(new Request("https://fluent-me.test/api/personalization/status"), {
      ELEVENLABS_API_KEY: "eleven-secret",
      TAVUS_API_KEY: "tavus-secret",
    });
    const body = await response.json();
    assert.equal(body.elevenlabs.tier, "starter");
    assert.equal(body.elevenlabs.character_limit, 30000);
    assert.equal(body.elevenlabs.can_use_instant_voice_cloning, true);
    assert.equal(body.elevenlabs.voice_remixing_configured, true);
    assert.equal(body.elevenlabs.voice_remixing_availability, "unknown");
    assert.equal(body.elevenlabs.voice_remixing_available, null);
    assert.deepEqual(body.elevenlabs.remix_strengths, ["low", "medium"]);
    assert.equal(body.tavus.configured, true);
    assert.doesNotMatch(JSON.stringify(body), /secret|private_account_field/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker remixes an owned voice at low and medium strength without changing the original", async () => {
  const originalFetch = globalThis.fetch;
  const providerCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    providerCalls.push({ url: String(url), method: options.method || "GET", body: options.body });
    if (String(url).endsWith("/voices/voice_personal_123")) {
      return responseJson({
        voice_id: "voice_personal_123",
        is_owner: true,
        preview_url: "https://storage.googleapis.com/eleven-public-prod/source.mp3",
        private_field: "do-not-return",
      });
    }
    if (String(url).endsWith("/text-to-voice/voice_personal_123/remix")) {
      const requestBody = JSON.parse(options.body);
      const label = requestBody.prompt_strength === 0.25 ? "low" : "medium";
      assert.equal(options.headers["xi-api-key"], "eleven-secret");
      assert.equal(requestBody.stream_previews, false);
      assert.equal(requestBody.guidance_scale, 2);
      assert.match(requestBody.voice_description, /General American/);
      return responseJson({
        text: requestBody.text,
        previews: [{
          generated_voice_id: `generated_${label}_123`,
          audio_base_64: Buffer.from(`audio-${label}`).toString("base64"),
          media_type: "audio/mpeg",
          duration_secs: 1.25,
          language: "en",
        }],
      });
    }
    throw new Error(`Unexpected ElevenLabs request: ${url}`);
  };

  try {
    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice/remix",
      {
        method: "POST",
        headers: { origin: "https://fluent-me.test", "content-type": "application/json" },
        body: JSON.stringify({
          voice_id: "voice_personal_123",
          target_accent: "general_american",
          consent: true,
        }),
      },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.source_voice_id, "voice_personal_123");
    assert.equal(body.original_preserved, true);
    assert.equal(body.target_accent, "general_american");
    assert.equal(body.source_preview_url, "https://storage.googleapis.com/eleven-public-prod/source.mp3");
    assert.deepEqual(body.previews.map(item => item.strength), ["low", "medium"]);
    assert.deepEqual(body.previews.map(item => item.prompt_strength), [0.25, 0.55]);
    assert.ok(body.previews.every(item => item.audio_base_64 && item.media_type === "audio/mpeg"));
    assert.ok(body.previews.every(item => /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(item.preview_handle)));
    const signedPayload = JSON.parse(Buffer.from(body.previews[0].preview_handle.split(".")[1], "base64url"));
    assert.equal(signedPayload.source_voice_id, "voice_personal_123");
    assert.equal(signedPayload.generated_voice_id, "generated_low_123");
    assert.equal(signedPayload.target_accent, "general_american");
    assert.equal(signedPayload.strength, "low");
    assert.equal(signedPayload.exp - signedPayload.iat, 15 * 60);
    assert.equal(providerCalls.filter(call => call.url.endsWith("/remix")).length, 2);
    assert.ok(providerCalls.every(call => !/delete|edit/i.test(call.url) && call.method !== "DELETE"));
    assert.doesNotMatch(JSON.stringify(body), /eleven-secret|private_field/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker supports a single British remix strength and saves it as a new voice", async () => {
  const originalFetch = globalThis.fetch;
  let remixPayload;
  let savePayload;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/voices/voice_personal_123")) {
      return responseJson({
        voice_id: "voice_personal_123",
        is_owner: true,
        preview_url: "https://localhost/private-source.mp3",
      });
    }
    if (String(url).endsWith("/text-to-voice/voice_personal_123/remix")) {
      remixPayload = JSON.parse(options.body);
      return responseJson({ previews: [{
        generated_voice_id: "generated_british_123",
        audio_base_64: Buffer.from("british-preview").toString("base64"),
        media_type: "audio/mpeg",
        duration_secs: 1,
        language: "en",
      }] });
    }
    if (String(url).endsWith("/text-to-voice")) {
      savePayload = JSON.parse(options.body);
      return responseJson({ voice_id: "voice_future_me_123", name: "Future Me British" });
    }
    throw new Error(`Unexpected ElevenLabs request: ${url}`);
  };

  try {
    const previewResponse = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice/remix",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice_id: "voice_personal_123", target_accent: "modern_british", strength: "medium", consent: true }),
      },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    const preview = await previewResponse.json();
    assert.equal(previewResponse.status, 200);
    assert.equal(preview.previews.length, 1);
    assert.equal(preview.previews[0].strength, "medium");
    assert.equal(preview.source_preview_url, null);
    assert.equal(remixPayload.prompt_strength, 0.55);
    assert.match(remixPayload.voice_description, /modern British/);

    const handle = preview.previews[0].preview_handle;
    const tamperedParts = handle.split(".");
    tamperedParts[2] = (tamperedParts[2].startsWith("A") ? "B" : "A") + tamperedParts[2].slice(1);
    const tamperedHandle = tamperedParts.join(".");
    const tamperedResponse = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice/remix/save",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preview_handle: tamperedHandle, consent: true }),
      },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    assert.equal(tamperedResponse.status, 400);
    assert.match((await tamperedResponse.json()).error, /invalid or has expired/);
    assert.equal(savePayload, undefined);

    const savedResponse = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice/remix/save",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preview_handle: handle,
          generated_voice_id: "generated_attacker_claim_123",
          voice_id: "voice_attacker_claim_123",
          name: "Future Me British",
          consent: true,
        }),
      },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    const saved = await savedResponse.json();
    assert.equal(savedResponse.status, 200);
    assert.deepEqual(saved, {
      voice_id: "voice_future_me_123",
      name: "Future Me British",
      source: "remix",
      source_voice_id: "voice_personal_123",
      target_accent: "modern_british",
      strength: "medium",
      original_preserved: true,
    });
    assert.equal(savePayload.generated_voice_id, "generated_british_123");
    assert.match(savePayload.voice_description, /original voice remains unchanged/);
    assert.doesNotMatch(JSON.stringify(saved), /eleven-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker rejects unowned sources, unsigned save claims, and oversized remix audio", async () => {
  const originalFetch = globalThis.fetch;
  let remixCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/voices/voice_not_owned_123")) {
      return responseJson({ voice_id: "voice_not_owned_123", is_owner: false });
    }
    if (String(url).endsWith("/voices/voice_personal_123")) {
      return responseJson({ voice_id: "voice_personal_123", is_owner: true });
    }
    if (String(url).endsWith("/text-to-voice/voice_personal_123/remix")) {
      remixCalls += 1;
      return responseJson({ previews: [{
        generated_voice_id: "generated_too_big_123",
        audio_base_64: "A".repeat(4_194_312),
        media_type: "audio/mpeg",
      }] });
    }
    throw new Error(`Provider must not receive unsafe save request: ${url} ${options.method || "GET"}`);
  };
  try {
    const unowned = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice/remix",
      { method: "POST", body: JSON.stringify({ voice_id: "voice_not_owned_123", consent: true }) },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    assert.equal(unowned.status, 403);
    assert.match((await unowned.json()).error, /owned/);
    assert.equal(remixCalls, 0);

    const unsafeSave = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice/remix/save",
      { method: "POST", body: JSON.stringify({ generated_voice_id: "generated_unsigned_123", consent: true }) },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    assert.equal(unsafeSave.status, 400);

    const oversized = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice/remix",
      { method: "POST", body: JSON.stringify({ voice_id: "voice_personal_123", strength: "low", consent: true }) },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    assert.equal(oversized.status, 502);
    assert.doesNotMatch(await oversized.text(), /AAAA|eleven-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker creates a consented voice clone and private-voice PAL", async () => {
  const originalFetch = globalThis.fetch;
  let voiceForm;
  let palBody;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/voices/add")) {
      voiceForm = options.body;
      assert.equal(options.headers["xi-api-key"], "eleven-secret");
      return responseJson({ voice_id: "voice_personal_123", requires_verification: false });
    }
    if (String(url).endsWith("/pals")) {
      palBody = JSON.parse(options.body);
      assert.equal(options.headers["x-api-key"], "tavus-secret");
      return responseJson({ pal_id: "pal_personal_123" });
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const form = new FormData();
    form.append("name", "Daming's voice");
    form.append("consent", "true");
    form.append("audio", new Blob([new Uint8Array(2000)], { type: "audio/webm" }), "voice.webm");
    const voiceResponse = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice",
      { method: "POST", body: form },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    const voice = await voiceResponse.json();
    assert.equal(voice.voice_id, "voice_personal_123");
    assert.equal(voiceForm.get("name"), "Daming's voice");
    assert.equal(voiceForm.get("files").size, 2000);

    const palResponse = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/pal",
      { method: "POST", body: JSON.stringify({ voice_id: voice.voice_id }) },
    ), { ELEVENLABS_API_KEY: "eleven-secret", TAVUS_API_KEY: "tavus-secret" });
    const pal = await palResponse.json();
    assert.equal(pal.pal_id, "pal_personal_123");
    assert.equal(palBody.layers.tts.tts_engine, "elevenlabs");
    assert.equal(palBody.layers.tts.external_voice_id, voice.voice_id);
    assert.equal(palBody.layers.tts.api_key, "eleven-secret");
    assert.equal(palBody.layers.perception.perception_model, "raven-1");
    assert.equal(palBody.layers.conversational_flow.turn_detection_model, "sparrow-1");
    assert.doesNotMatch(JSON.stringify(pal), /eleven-secret|tavus-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker never reflects provider secrets in errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responseJson({
    message: "invalid config includes eleven-secret and tavus-secret",
  }, 422);
  try {
    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/pal",
      { method: "POST", body: JSON.stringify({ voice_id: "voice_personal_123" }) },
    ), { ELEVENLABS_API_KEY: "eleven-secret", TAVUS_API_KEY: "tavus-secret" });
    const body = await response.text();
    assert.equal(response.status, 422);
    assert.doesNotMatch(body, /eleven-secret|tavus-secret|invalid config/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker validates and creates a Phoenix-4 personal face", async () => {
  const originalFetch = globalThis.fetch;
  let faceBody;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://tavusapi.com/v2/faces");
    faceBody = JSON.parse(options.body);
    return responseJson({ face_id: "face_personal_123", status: "started" });
  };
  try {
    const invalid = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/face",
      { method: "POST", body: JSON.stringify({ consent: true, train_video_url: "http://localhost/video.webm" }) },
    ), { TAVUS_API_KEY: "tavus-secret" });
    assert.equal(invalid.status, 400);

    for (const unsafeUrl of [
      "https://127.0.0.1/video.webm",
      "https://192.168.1.4/video.webm",
      "https://169.254.169.254/latest/meta-data",
      "https://user:pass@storage.example/video.webm",
      "https://host.internal/video.webm",
    ]) {
      const unsafe = await worker.fetch(new Request(
        "https://fluent-me.test/api/personalization/face",
        { method: "POST", body: JSON.stringify({ consent: true, train_video_url: unsafeUrl }) },
      ), { TAVUS_API_KEY: "tavus-secret" });
      assert.equal(unsafe.status, 400, unsafeUrl);
    }

    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/face",
      { method: "POST", body: JSON.stringify({ consent: true, face_name: "Daming", train_video_url: "https://storage.example/private-signed-video.webm" }) },
    ), { TAVUS_API_KEY: "tavus-secret" });
    const body = await response.json();
    assert.equal(body.face_id, "face_personal_123");
    assert.equal(faceBody.model_name, "phoenix-4");
    assert.equal(faceBody.train_video_url, "https://storage.example/private-signed-video.webm");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker starts a conversation with saved personal face and PAL ids", async () => {
  const originalFetch = globalThis.fetch;
  let conversationBody;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://tavusapi.com/v2/conversations");
    conversationBody = JSON.parse(options.body);
    return responseJson({
      conversation_id: "c-personal",
      conversation_url: "https://tavus.daily.co/c-personal",
      meeting_token: "short-lived-token",
    });
  };
  try {
    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/tavus/conversations",
      { method: "POST", body: JSON.stringify({ face_id: "face_personal_123", pal_id: "pal_personal_123" }) },
    ), { TAVUS_API_KEY: "tavus-secret" });
    assert.equal(response.status, 200);
    assert.equal(conversationBody.face_id, "face_personal_123");
    assert.equal(conversationBody.pal_id, "pal_personal_123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker serves the v3 social image and keeps the old routes compatible", async () => {
  const current = await worker.fetch(new Request(
    "https://fluent-me.test/static/og-language-coach-v3.png",
  ), {});
  const legacy = await worker.fetch(new Request(
    "https://fluent-me.test/static/og-personal-coach.png",
  ), {});

  assert.equal(current.status, 200);
  assert.equal(current.headers.get("content-type"), "image/png");
  assert.ok((await current.arrayBuffer()).byteLength > 1000);
  assert.deepEqual(
    Buffer.from(await legacy.arrayBuffer()),
    Buffer.from(await (await worker.fetch(new Request(
      "https://fluent-me.test/static/og-language-coach-v3.png",
    ), {})).arrayBuffer()),
  );
});

test("Sites Worker rejects an oversized voice request before multipart parsing", async () => {
  const response = await worker.fetch(new Request(
    "https://fluent-me.test/api/personalization/voice",
    {
      method: "POST",
      headers: {
        "content-length": String(22 * 1024 * 1024),
        "content-type": "multipart/form-data; boundary=not-parsed",
      },
      body: "this body must not be parsed",
    },
  ), { ELEVENLABS_API_KEY: "eleven-secret" });

  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /20 MB/);
});

test("Sites Worker rejects non-audio voice uploads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider must not be called for an invalid MIME type");
  };
  try {
    const form = new FormData();
    form.append("name", "Not audio");
    form.append("consent", "true");
    form.append("audio", new Blob([new Uint8Array(2000)], { type: "text/plain" }), "voice.txt");
    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/voice",
      { method: "POST", body: form },
    ), { ELEVENLABS_API_KEY: "eleven-secret" });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /audio recording format/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker maps provider timeouts to a safe 504", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("timeout included eleven-secret");
    error.name = "TimeoutError";
    throw error;
  };
  try {
    const response = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/status",
    ), { ELEVENLABS_API_KEY: "eleven-secret" });
    const body = await response.text();

    assert.equal(response.status, 504);
    assert.match(body, /did not respond in time/);
    assert.doesNotMatch(body, /eleven-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sites Worker sanitizes Face training and conversation end errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes("/faces/")) {
      return responseJson({
        face_id: "face_personal_123",
        status: "error",
        error_message: "signed-url=private-token tavus-secret",
      });
    }
    if (String(url).endsWith("/conversations/c-private/end")) {
      return responseJson({ message: "signed-url=private-token tavus-secret" }, 500);
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const faceResponse = await worker.fetch(new Request(
      "https://fluent-me.test/api/personalization/face/face_personal_123",
    ), { TAVUS_API_KEY: "tavus-secret" });
    const faceBody = await faceResponse.text();
    assert.equal(faceResponse.status, 200);
    assert.match(faceBody, /could not train this video/);
    assert.doesNotMatch(faceBody, /private-token|tavus-secret/);

    const endResponse = await worker.fetch(new Request(
      "https://fluent-me.test/api/tavus/conversations/c-private/end",
      { method: "POST" },
    ), { TAVUS_API_KEY: "tavus-secret" });
    const endBody = await endResponse.text();
    assert.equal(endResponse.status, 500);
    assert.match(endBody, /could not complete that request/);
    assert.doesNotMatch(endBody, /private-token|tavus-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
