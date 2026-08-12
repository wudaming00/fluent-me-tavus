import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


const source = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
const encoded = Buffer.from(source).toString("base64");
const { default: worker } = await import(`data:text/javascript;base64,${encoded}`);

const responseJson = value => new Response(JSON.stringify(value), {
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
          data: [{ pal_name: "Fluent Me Conversation Coach v4", pal_id: "pal-existing" }],
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
  const html = await response.text();
  assert.match(html, /Start talking/);
  assert.doesNotMatch(html, /Step 1 of 5|Hear the model/);
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
      return responseJson({ pal_id: "pal-v4" });
    }
    if (String(url).endsWith("/conversations")) {
      const body = JSON.parse(options.body);
      assert.equal(body.pal_id, "pal-v4");
      return responseJson({
        conversation_id: "c-v4",
        conversation_url: "https://tavus.daily.co/c-v4",
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
    assert.equal(createdPal.pal_name, "Fluent Me Conversation Coach v4");
    assert.match(createdPal.system_prompt, /learner-led conversation/);
    assert.equal(createdPal.layers.perception.emotion_recognition, "limited");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
