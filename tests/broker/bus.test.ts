import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBus } from "../../src/broker/bus.ts";
import { Broker } from "../../src/broker/broker.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import { FeedRenderer } from "../../src/broker/feed.ts";
import type { Transport } from "../../src/broker/transport.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

class NoopTransport implements Transport {
  async deliver(): Promise<void> {}
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}
const card = (id: string): AgentCard => ({
  id, role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [], workdir: ".", subscribes: [],
});

const msg = (id: string): Message => ({
  id, from: "a", to: "b", type: "note", parts: [{ kind: "text", text: "x" }], ts: "2026-06-07T00:00:00Z",
});

test("MemoryBus.publish returns a promise and fans out to subscribers", async () => {
  const bus = new MemoryBus();
  const seen: string[] = [];
  bus.subscribe((m) => seen.push(m.id));
  await bus.publish(msg("m1"));
  assert.deepEqual(seen, ["m1"]);
});

test("MemoryBus.subscribe returns an unsubscribe handle", async () => {
  const bus = new MemoryBus();
  const seen: string[] = [];
  const off = bus.subscribe((m) => seen.push(m.id));
  off();
  await bus.publish(msg("m2"));
  assert.deepEqual(seen, []);
});

test("the broker publishes every recorded message to the bus", async () => {
  const bus = new MemoryBus();
  const published: string[] = [];
  bus.subscribe((m) => published.push(m.type));
  const fs = new MemoryFs();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport: new NoopTransport(), clock: new FixedClock(), ids: new SeqIds(),
    publisher: bus,
  });
  broker.register(card("a")); broker.register(card("b"));
  await broker.send({ from: "a", to: "b", type: "note", parts: [{ kind: "text", text: "hi" }] });
  await broker.observe({ id: "m9", from: "a", to: "b", type: "status", parts: [{ kind: "text", text: "x" }], ts: "t" });
  assert.deepEqual(published, ["note", "status"]); // both send + observe paths publish
});
