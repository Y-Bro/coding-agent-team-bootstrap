import { test } from "node:test";
import assert from "node:assert/strict";
import { Broker } from "../../src/broker/broker.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import { FeedRenderer } from "../../src/broker/feed.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { Runtime, SpawnCtx } from "../../src/runtime/runtime.ts";
import type { AgentCard } from "../../src/a2a/index.ts";

class SpyRuntime implements Runtime {
  woke: Array<{ id: string; summary: string }> = [];
  async spawn(_a: AgentCard, _c: SpawnCtx): Promise<void> {}
  async wake(id: string, summary: string): Promise<void> { this.woke.push({ id, summary }); }
  async teardown(): Promise<void> {}
}

function makeBroker(runtime: Runtime) {
  const fs = new MemoryFs();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry,
    router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    runtime,
    clock: new FixedClock(),
    ids: new SeqIds(),
  });
  return { broker, fs };
}

const card = (over: Partial<AgentCard>): AgentCard => ({
  id: "x", role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [],
  workdir: ".", subscribes: [], ...over,
});

test("send routes, persists, wakes, and lands in recipient inbox", async () => {
  const runtime = new SpyRuntime();
  const { broker } = makeBroker(runtime);
  broker.register(card({ id: "fe-writer", role: "writer" }));
  broker.register(card({ id: "fe-reviewer", role: "reviewer" }));

  const sent = await broker.send({ from: "fe-writer", to: "fe-reviewer", type: "review_request",
    parts: [{ kind: "text", text: "slice 4" }] });

  assert.equal(sent.id, "m1");
  assert.equal(sent.ts, "2026-06-06T00:00:00.000Z");
  assert.deepEqual(runtime.woke, [{ id: "fe-reviewer", summary: "review_request from fe-writer" }]);
  assert.equal(broker.inbox("fe-reviewer").length, 1);
  assert.equal(broker.inbox("fe-reviewer").length, 0);
});

test("state rebuilds from the JSONL log on a new broker", async () => {
  const runtime = new SpyRuntime();
  const { broker, fs } = makeBroker(runtime);
  broker.register(card({ id: "a" })); broker.register(card({ id: "b" }));
  await broker.send({ from: "a", to: "b", type: "note", parts: [{ kind: "text", text: "hi" }] });

  const registry2 = new AgentRegistry();
  const broker2 = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry: registry2, router: new Router(registry2),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    runtime, clock: new FixedClock(), ids: new SeqIds(),
  });
  broker2.register(card({ id: "b" }));
  broker2.rebuild();
  assert.equal(broker2.inbox("b").length, 1);
});
