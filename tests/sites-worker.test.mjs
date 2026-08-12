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
  ["Lucas by default", undefined, "r5f0577fc829"],
  ["an environment override", "face-custom-male", "face-custom-male"],
]) {
  test(`Sites Worker uses ${label} with an existing PAL`, async () => {
    const originalFetch = globalThis.fetch;
    let conversationBody;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).endsWith("/pals?limit=100")) {
        return responseJson({
          data: [{ pal_name: "Fluent Me Language Coach v3", pal_id: "pal-existing" }],
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
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
