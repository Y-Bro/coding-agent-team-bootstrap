import { test } from "node:test";
import assert from "node:assert/strict";
import { A2AClient } from "../../src/a2a/http/client.ts";
import type { HttpClient, HttpResponse } from "../../src/ports/http.ts";
import type { Message } from "../../src/a2a/index.ts";

/** Records every URL dialed and returns a canned message/send result. */
class RecordingHttpClient implements HttpClient {
  urls: string[] = [];
  async request(url: string, _init: { method: string; body?: string }): Promise<HttpResponse> {
    this.urls.push(url);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { id: "m1" } } }) };
  }
}

const msg: Message = { id: "m1", from: "a", to: "b", type: "note", parts: [{ kind: "text", text: "hi" }], ts: "t" };

test("A2AClient dials its configured REMOTE base URL, not loopback", async () => {
  const http = new RecordingHttpClient();
  const client = new A2AClient(http, "https://reviewer.remote.example:8443");
  await client.sendMessage(msg);
  assert.equal(http.urls.length, 1);
  assert.ok(http.urls[0]!.startsWith("https://reviewer.remote.example:8443/"), `dialed ${http.urls[0]}`);
  assert.doesNotMatch(http.urls[0]!, /127\.0\.0\.1|localhost/);
});
