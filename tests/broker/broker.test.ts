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
  /** When set, deliver() throws for this recipient id (simulates a down/unreachable agent). */
  failFor?: string;
  async deliver(recipient: AgentCard, message: Message): Promise<void> {
    if (recipient.id === this.failFor) throw new Error(`transport down for ${recipient.id}`);
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
  assert.equal(broker.peek("fe-reviewer").length, 1);
  broker.ack("fe-reviewer", [sent.id]);
  assert.equal(broker.peek("fe-reviewer").length, 0);
});

test("emitInternal records to inbox + feed + delivers (sweep parity)", async () => {
  const transport = new SpyTransport();
  const { broker, fs } = makeBroker(transport);
  broker.register(card({ id: "lead", role: "lead" }));

  const m: Message = {
    id: "m-int-1", from: "broker", to: "lead", type: "escalation_request",
    parts: [{ kind: "text", text: "dead letter" }], ts: "2026-06-06T00:00:00.000Z",
  };
  await broker.emitInternal(m);

  assert.ok(broker.peek("lead").some((x) => x.id === "m-int-1"), "in lead inbox");
  assert.match(fs.read(".team/feed.md"), /dead letter/);
  assert.match(fs.read(".team/messages.jsonl"), /m-int-1/);
  assert.ok(transport.delivered.some((d) => d.id === "lead"), "delivered/woken");
});

test("send tolerates a transport failure for one recipient (at-least-once; inbox is source of truth)", async () => {
  const transport = new SpyTransport();
  transport.failFor = "a"; // a's wake throws; b's succeeds
  const { broker } = makeBroker(transport);
  broker.register(card({ id: "a", role: "pair" }));
  broker.register(card({ id: "b", role: "pair" }));

  // addressing the shared role resolves BOTH a and b
  const m = await broker.send({ from: "x", to: "pair", type: "note", parts: [{ kind: "text", text: "hi" }] });

  // message is still durable + in BOTH inboxes despite a's transport failing, and send did not throw
  assert.ok(broker.peek("a").some((x) => x.id === m.id), "in a's inbox despite failed wake");
  assert.ok(broker.peek("b").some((x) => x.id === m.id), "in b's inbox");
  assert.ok(transport.delivered.some((d) => d.id === "b"), "b still delivered after a failed");
});

test("peek is non-destructive; ack removes only acked ids", async () => {
  const { broker } = makeBroker(new SpyTransport());
  broker.register(card({ id: "lead" }));
  broker.register(card({ id: "writer" }));
  await broker.send({ from: "lead", to: "writer", type: "note", parts: [{ kind: "text", text: "1" }] });
  await broker.send({ from: "lead", to: "writer", type: "note", parts: [{ kind: "text", text: "2" }] });
  const first = broker.peek("writer");
  assert.equal(first.length, 2);
  assert.equal(broker.peek("writer").length, 2); // still there (non-destructive)
  broker.ack("writer", [first[0]!.id]);
  const rest = broker.peek("writer");
  assert.equal(rest.length, 1);
  assert.equal(rest[0]!.id, first[1]!.id);
});

test("rebuild skips acked messages (watermark survives restart)", async () => {
  const { broker, fs } = makeBroker(new SpyTransport());
  broker.register(card({ id: "lead" }));
  broker.register(card({ id: "writer" }));
  await broker.send({ from: "lead", to: "writer", type: "note", parts: [{ kind: "text", text: "1" }] });
  const m = broker.peek("writer")[0]!;
  broker.ack("writer", [m.id]);

  const registry2 = new AgentRegistry();
  const fresh = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry: registry2, router: new Router(registry2),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport: new SpyTransport(), clock: new FixedClock(), ids: new SeqIds(),
  });
  fresh.register(card({ id: "writer" }));
  fresh.rebuild();
  assert.equal(fresh.peek("writer").length, 0); // acked message not re-delivered
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
  assert.equal(broker2.peek("b").length, 1);
});

test("observe logs + feeds + tracks inbox WITHOUT delivering over the transport (direct mode)", async () => {
  const transport = new SpyTransport();
  const { broker, fs } = makeBroker(transport);
  broker.register(card({ id: "a" }));
  broker.register(card({ id: "b" }));

  // a message already delivered peer-to-peer; the broker only observes it
  const m: Message = {
    id: "m-direct-1", from: "a", to: "b", type: "note",
    parts: [{ kind: "text", text: "direct hello" }], ts: "2026-06-06T00:00:00.000Z",
  };
  await broker.observe(m);

  // NOT in the delivery path — the transport was never asked to deliver
  assert.deepEqual(transport.delivered, []);
  // durable log + feed recorded the message
  assert.match(fs.read(".team/messages.jsonl"), /m-direct-1/);
  assert.match(fs.read(".team/feed.md"), /direct hello/);
  // inbox parity for live queries
  assert.equal(broker.peek("b").length, 1);
});

test("rebuild reconstructs full state purely from the observed JSONL log", async () => {
  const transport = new SpyTransport();
  const { broker, fs } = makeBroker(transport);
  broker.register(card({ id: "a" }));
  broker.register(card({ id: "b" }));
  await broker.observe({
    id: "m-obs-1", from: "a", to: "b", type: "note",
    parts: [{ kind: "text", text: "logged via observe" }], ts: "2026-06-06T00:00:00.000Z",
  });

  // a fresh broker over the SAME log rebuilds the recipient's inbox, no transport
  const registry2 = new AgentRegistry();
  const broker2 = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry: registry2, router: new Router(registry2),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport, clock: new FixedClock(), ids: new SeqIds(),
  });
  broker2.register(card({ id: "b" }));
  broker2.rebuild();
  assert.equal(broker2.peek("b").length, 1);
  assert.deepEqual(transport.delivered, []);
});
