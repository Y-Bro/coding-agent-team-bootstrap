import { test } from "node:test";
import assert from "node:assert/strict";
import { Broker } from "../../src/broker/broker.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import { FeedRenderer } from "../../src/broker/feed.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { Transport } from "../../src/broker/transport.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

class SpyTransport implements Transport {
  delivered: Array<{ id: string; type: string; from: string }> = [];
  async deliver(recipient: AgentCard, message: Message): Promise<void> {
    this.delivered.push({ id: recipient.id, type: message.type, from: message.from });
  }
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}

function makeBroker(transport: Transport) {
  const fs = new MemoryFs();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry,
    router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport,
    clock: new FixedClock(),
    ids: new SeqIds(),
  });
  return { broker, fs };
}

const card = (over: Partial<AgentCard>): AgentCard => ({
  id: "x", role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [],
  workdir: ".", subscribes: [], ...over,
});

test("send routes, persists, delivers over the transport, and lands in recipient inbox", async () => {
  const transport = new SpyTransport();
  const { broker } = makeBroker(transport);
  broker.register(card({ id: "fe-writer", role: "writer" }));
  broker.register(card({ id: "fe-reviewer", role: "reviewer" }));

  const sent = await broker.send({ from: "fe-writer", to: "fe-reviewer", type: "review_request",
    parts: [{ kind: "text", text: "slice 4" }] });

  assert.equal(sent.id, "m1");
  assert.equal(sent.ts, "2026-06-06T00:00:00.000Z");
  // routing resolved fe-reviewer, then delivered over the (fake) transport
  assert.deepEqual(transport.delivered, [{ id: "fe-reviewer", type: "review_request", from: "fe-writer" }]);
  assert.equal(broker.inbox("fe-reviewer").length, 1);
  assert.equal(broker.inbox("fe-reviewer").length, 0);
});

test("state rebuilds from the JSONL log on a new broker (unchanged)", async () => {
  const transport = new SpyTransport();
  const { broker, fs } = makeBroker(transport);
  broker.register(card({ id: "a" })); broker.register(card({ id: "b" }));
  await broker.send({ from: "a", to: "b", type: "note", parts: [{ kind: "text", text: "hi" }] });

  const registry2 = new AgentRegistry();
  const broker2 = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry: registry2, router: new Router(registry2),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport, clock: new FixedClock(), ids: new SeqIds(),
  });
  broker2.register(card({ id: "b" }));
  broker2.rebuild();
  assert.equal(broker2.inbox("b").length, 1);
});
