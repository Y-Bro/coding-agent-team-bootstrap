import { test } from "node:test";
import assert from "node:assert/strict";
import { A2AServer } from "../../../src/a2a/http/server.ts";
import { FakeHttpServer } from "./fakes.ts";
import { A2A_PATHS, JSON_RPC_ERRORS } from "../../../src/a2a/http/types.ts";
import type { AgentCard, Message } from "../../../src/a2a/index.ts";

const card: AgentCard = {
  id: "fe-reviewer", role: "reviewer", cli: "codex", engine: "codex",
  capabilities: ["frontend"], skills: [], workdir: ".", subscribes: ["review_request"],
};

const msg: Message = {
  id: "m1", from: "fe-writer", to: "fe-reviewer", type: "review_request",
  parts: [{ kind: "text", text: "slice 4" }], ts: "2026-06-06T00:00:00.000Z",
};

const rpc = (method: string, params: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

test("serves the agent card at the well-known path", async () => {
  const http = new FakeHttpServer();
  new A2AServer(http, card, { onMessageSend: async ({ message }) => ({ message }) }).register();
  const res = await http.handle({ method: "GET", path: A2A_PATHS.agentCard, body: "" });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), card);
});

test("handles message/send and returns the handler's result", async () => {
  const http = new FakeHttpServer();
  const received: Message[] = [];
  new A2AServer(http, card, {
    onMessageSend: async ({ message }) => { received.push(message); return { message }; },
  }).register();

  const res = await http.handle({ method: "POST", path: A2A_PATHS.rpc, body: rpc("message/send", { message: msg }) });
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 1);
  assert.equal(body.result.message.id, "m1");
  assert.equal(received.length, 1);
});

test("unknown method returns a JSON-RPC methodNotFound error", async () => {
  const http = new FakeHttpServer();
  new A2AServer(http, card, { onMessageSend: async ({ message }) => ({ message }) }).register();
  const res = await http.handle({ method: "POST", path: A2A_PATHS.rpc, body: rpc("foo/bar", {}) });
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, JSON_RPC_ERRORS.methodNotFound);
});

test("a handler that throws surfaces a JSON-RPC internalError", async () => {
  const http = new FakeHttpServer();
  new A2AServer(http, card, {
    onMessageSend: async () => { throw new Error("boom"); },
  }).register();
  const res = await http.handle({ method: "POST", path: A2A_PATHS.rpc, body: rpc("message/send", { message: msg }) });
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, JSON_RPC_ERRORS.internalError);
  assert.match(body.error.message, /boom/);
});
