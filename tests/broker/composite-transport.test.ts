import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositeTransport } from "../../src/broker/composite-transport.ts";
import { Broker } from "../../src/broker/broker.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import { FeedRenderer } from "../../src/broker/feed.ts";
import type { Transport } from "../../src/broker/transport.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

class SpyTransport implements Transport {
  delivered: string[] = [];
  constructor(private label: string) {}
  async deliver(r: AgentCard, m: Message): Promise<void> { this.delivered.push(`${this.label}:${r.id}:${m.from}`); }
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}

const card = (over: Partial<AgentCard> & { runtime?: string }): AgentCard => ({
  id: "x", role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [],
  workdir: ".", subscribes: [], ...over,
} as AgentCard);

function mixedBroker() {
  const socket = new SpyTransport("socket");
  const a2a = new SpyTransport("a2a");
  const transport = new CompositeTransport(
    { panes: socket, servers: a2a },
    (r) => ((r as { runtime?: "panes" | "servers" }).runtime ?? "panes"),
  );
  const fs = new MemoryFs();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport, clock: new FixedClock(), ids: new SeqIds(),
  });
  // a pane agent and a server agent in one team
  broker.register(card({ id: "pane-writer", role: "writer", runtime: "panes" }));
  broker.register(card({ id: "srv-reviewer", role: "reviewer", runtime: "servers" }));
  return { broker, socket, a2a };
}

test("pane → server: broker delivers to a server recipient over the A2A transport", async () => {
  const { broker, socket, a2a } = mixedBroker();
  await broker.send({ from: "pane-writer", to: "srv-reviewer", type: "review_request", parts: [{ kind: "text", text: "PR" }] });
  assert.deepEqual(a2a.delivered, ["a2a:srv-reviewer:pane-writer"]);
  assert.deepEqual(socket.delivered, []);
});

test("server → pane: broker delivers to a pane recipient over the socket transport", async () => {
  const { broker, socket, a2a } = mixedBroker();
  await broker.send({ from: "srv-reviewer", to: "pane-writer", type: "note", parts: [{ kind: "text", text: "hi" }] });
  assert.deepEqual(socket.delivered, ["socket:pane-writer:srv-reviewer"]);
  assert.deepEqual(a2a.delivered, []);
});
