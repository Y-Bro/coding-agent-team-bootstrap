import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeSseFrame, encodeSseStream, parseSseFrames,
  registerStreamRoute, streamMessage, SSE_CONTENT_TYPE, type StreamEvent,
} from "../../../src/a2a/http/stream.ts";
import { A2A_PATHS, JSON_RPC_ERRORS } from "../../../src/a2a/http/types.ts";
import { BrokerAuthProvider, bearerHeader } from "../../../src/a2a/http/auth.ts";
import { SeqIds } from "../../ports/fakes.ts";
import { FakeHttpServer, FakeHttpClient } from "./fakes.ts";
import type { Message } from "../../../src/a2a/index.ts";

const msg: Message = {
  id: "m1", from: "fe-writer", to: "fe-reviewer", type: "review_request",
  parts: [{ kind: "text", text: "slice 4" }], ts: "2026-06-06T00:00:00.000Z",
};

test("encodeSseFrame emits an SSE event terminated by a blank line", () => {
  assert.equal(encodeSseFrame({ data: { n: 1 } }), "data: {\"n\":1}\n\n");
  assert.equal(encodeSseFrame({ event: "done", data: 0 }), "event: done\ndata: 0\n\n");
});

test("encode/parse round-trips a frame sequence in order", () => {
  const events: StreamEvent[] = [
    { event: "chunk", data: { text: "a" } },
    { event: "chunk", data: { text: "b" } },
    { event: "done", data: { ok: true } },
  ];
  const parsed = parseSseFrames(encodeSseStream(events));
  assert.deepEqual(parsed, events);
});

test("parseSseFrames ignores blank padding between frames", () => {
  const body = "data: 1\n\n\n\ndata: 2\n\n";
  assert.deepEqual(parseSseFrames(body).map((e) => e.data), [1, 2]);
});

test("message/stream round-trips an SSE frame sequence over the fake HTTP layer", async () => {
  const server = new FakeHttpServer();
  registerStreamRoute(server, {
    onMessageStream: (m) => [
      { event: "chunk", data: { text: `re: ${m.id}` } },
      { event: "done", data: { ok: true } },
    ],
  });
  const client = new FakeHttpClient(server, "http://agent");
  const frames = await streamMessage(client, "http://agent", msg);
  assert.deepEqual(frames.map((f) => f.event), ["chunk", "done"]);
  assert.deepEqual((frames[0]!.data as { text: string }).text, "re: m1");
});

test("the stream route is registered at the SSE path", () => {
  const server = new FakeHttpServer();
  registerStreamRoute(server, { onMessageStream: () => [] });
  assert.ok(server.routes.has(`POST ${A2A_PATHS.rpcStream}`));
});

test("with auth: message/stream accepts a valid bearer and rejects missing/invalid", async () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  const token = auth.issueToken("fe-writer");
  const server = new FakeHttpServer();
  registerStreamRoute(server, { onMessageStream: () => [{ event: "done", data: { ok: true } }] }, auth);

  // valid token via the client helper round-trips frames
  const client = new FakeHttpClient(server, "http://agent");
  const frames = await streamMessage(client, "http://agent", msg, token);
  assert.deepEqual(frames.map((f) => f.event), ["done"]);

  // missing bearer -> unauthorized JSON-RPC error (not SSE)
  const noAuth = await server.handle({
    method: "POST", path: A2A_PATHS.rpcStream,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: msg } }),
  });
  assert.equal(JSON.parse(noAuth.body).error.code, JSON_RPC_ERRORS.unauthorized);

  // invalid bearer -> unauthorized
  const badAuth = await server.handle({
    method: "POST", path: A2A_PATHS.rpcStream, headers: bearerHeader("bogus"),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: msg } }),
  });
  assert.equal(JSON.parse(badAuth.body).error.code, JSON_RPC_ERRORS.unauthorized);
});

test("the stream route serves content-type text/event-stream", async () => {
  const server = new FakeHttpServer();
  registerStreamRoute(server, { onMessageStream: () => [{ data: 1 }] });
  const res = await server.handle({
    method: "POST", path: A2A_PATHS.rpcStream,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: msg } }),
  });
  assert.equal(res.headers?.["content-type"], SSE_CONTENT_TYPE);
  assert.equal(res.headers?.["cache-control"], "no-cache");
});
