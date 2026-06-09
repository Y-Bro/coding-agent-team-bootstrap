import { test } from "node:test";
import assert from "node:assert/strict";
import { BrokerDaemon } from "../../src/broker/daemon.ts";
import { Broker } from "../../src/broker/broker.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import { FeedRenderer } from "../../src/broker/feed.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { SocketServer } from "../../src/ports/transport.ts";
import type { Transport } from "../../src/broker/transport.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

class NoopTransport implements Transport {
  async deliver(): Promise<void> {}
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}

/** Captures the daemon's message handler so tests can invoke RPCs in-memory. */
class CaptureServer implements SocketServer {
  handler!: (msg: unknown, reply: (r: unknown) => void) => void;
  async listen(_path: string, onMessage: (msg: unknown, reply: (r: unknown) => void) => void): Promise<void> {
    this.handler = onMessage;
  }
  async close(): Promise<void> {}
  /** Drive one request through the daemon and resolve with its response. */
  call(msg: unknown): Promise<any> {
    return new Promise((resolve) => this.handler(msg, resolve));
  }
}

const card = (id: string): AgentCard => ({
  id, role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [], workdir: ".", subscribes: [],
});

test("inbox/peek then inbox/ack: the second peek is empty (round-trip)", async () => {
  const fs = new MemoryFs();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport: new NoopTransport(), clock: new FixedClock(), ids: new SeqIds(),
  });
  broker.register(card("lead")); broker.register(card("writer"));
  await broker.send({ from: "lead", to: "writer", type: "note", parts: [{ kind: "text", text: "hi" }] });

  const server = new CaptureServer();
  const daemon = new BrokerDaemon(broker, server);
  await daemon.start(".team/broker.sock");

  const peeked = await server.call({ method: "inbox/peek", params: { agentId: "writer" } });
  assert.equal(peeked.ok, true);
  assert.equal((peeked.result as Message[]).length, 1);

  const acked = await server.call({ method: "inbox/ack", params: { agentId: "writer", ids: [(peeked.result as Message[])[0]!.id] } });
  assert.equal(acked.ok, true);

  const again = await server.call({ method: "inbox/peek", params: { agentId: "writer" } });
  assert.equal((again.result as Message[]).length, 0);
});

test("daemon returns a structured error for an invalid request shape (missing method)", async () => {
  const fs = new MemoryFs();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport: new NoopTransport(), clock: new FixedClock(), ids: new SeqIds(),
  });
  const server = new CaptureServer();
  const daemon = new BrokerDaemon(broker, server);
  await daemon.start(".team/broker.sock");

  const res = await server.call({}); // no method field
  assert.equal(res.ok, false);
  assert.match(res.error, /missing method/);
});
