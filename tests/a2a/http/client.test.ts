import { test } from "node:test";
import assert from "node:assert/strict";
import { A2AClient } from "../../../src/a2a/http/client.ts";
import { A2AServer } from "../../../src/a2a/http/server.ts";
import { BrokerAuthProvider } from "../../../src/a2a/http/auth.ts";
import { SeqIds } from "../../ports/fakes.ts";
import { FakeHttpServer, FakeHttpClient } from "./fakes.ts";
import type { AgentCard, Message } from "../../../src/a2a/index.ts";

const card: AgentCard = {
  id: "fe-reviewer", role: "reviewer", cli: "codex", engine: "codex",
  capabilities: ["frontend"], skills: [], workdir: ".", subscribes: ["review_request"],
};
const msg: Message = {
  id: "m1", from: "fe-writer", to: "fe-reviewer", type: "review_request",
  parts: [{ kind: "text", text: "slice 4" }], ts: "2026-06-06T00:00:00.000Z",
};

const BASE = "http://localhost:7777";

function wired(handler = async ({ message }: { message: Message }) => ({ message })) {
  const server = new FakeHttpServer();
  new A2AServer(server, card, { onMessageSend: handler }).register();
  return new A2AClient(new FakeHttpClient(server, BASE), BASE);
}

test("fetchAgentCard returns the served card (round-trip through the wire)", async () => {
  const got = await wired().fetchAgentCard();
  assert.deepEqual(got, card);
});

test("sendMessage round-trips a message through message/send", async () => {
  const got = await wired().sendMessage(msg);
  assert.equal(got.id, "m1");
  assert.equal(got.type, "review_request");
});

test("with auth: a token-bearing client is accepted; a tokenless client is rejected", async () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  const token = auth.issueToken("fe-writer");
  const server = new FakeHttpServer();
  new A2AServer(server, card, { onMessageSend: async ({ message }) => ({ message }) }, auth).register();

  const authed = new A2AClient(new FakeHttpClient(server, BASE), BASE, token);
  assert.equal((await authed.sendMessage(msg)).id, "m1");

  const tokenless = new A2AClient(new FakeHttpClient(server, BASE), BASE);
  await assert.rejects(() => tokenless.sendMessage(msg), /bearer token/);
});

test("sendMessage throws a scheduler-recognized rate-limit error on HTTP 429", async () => {
  const server = new FakeHttpServer();
  // a route that responds 429 with a Retry-After hint
  server.route("POST", "/a2a", async () => ({
    status: 429, body: "", headers: { "retry-after": "2" },
  }));
  const client = new A2AClient(new FakeHttpClient(server, BASE), BASE);
  await assert.rejects(() => client.sendMessage(msg), (e: unknown) => {
    assert.equal((e as { status?: number }).status, 429);
    assert.equal((e as { retryAfterMs?: number }).retryAfterMs, 2000);
    return true;
  });
});

test("sendMessage surfaces a JSON-RPC error as a thrown Error", async () => {
  const client = wired(async () => { throw new Error("nope"); });
  await assert.rejects(() => client.sendMessage(msg), /nope/);
});
