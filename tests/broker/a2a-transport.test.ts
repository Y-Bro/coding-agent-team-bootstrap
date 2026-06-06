import { test } from "node:test";
import assert from "node:assert/strict";
import { A2ATransport, type A2ASender, type A2AEndpoints, type WebhookSender } from "../../src/broker/a2a-transport.ts";
import { FleetScheduler } from "../../src/runtime/servers/scheduler.ts";
import { A2AClient } from "../../src/a2a/http/client.ts";
import type { Clock } from "../../src/ports/clock.ts";
import type { Sleeper } from "../../src/ports/sleeper.ts";
import type { HttpClient, HttpResponse } from "../../src/ports/http.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

const card = (id: string): AgentCard => ({
  id, role: "reviewer", cli: "codex", engine: "codex",
  capabilities: [], skills: [], workdir: ".", subscribes: [],
});
const msg: Message = {
  id: "m1", from: "fe-writer", to: "fe-reviewer", type: "review_request",
  parts: [{ kind: "text", text: "slice 4" }], ts: "2026-06-06T00:00:00.000Z",
};

class SpySender implements A2ASender {
  sent: Message[] = [];
  async sendMessage(m: Message): Promise<Message> { this.sent.push(m); return m; }
}

test("A2ATransport.deliver pushes the message to the recipient's A2A endpoint", async () => {
  const senders = new Map<string, SpySender>();
  const endpoints: A2AEndpoints = {
    clientFor: (c) => { const s = senders.get(c.id) ?? new SpySender(); senders.set(c.id, s); return s; },
  };
  const t = new A2ATransport(endpoints);
  await t.deliver(card("fe-reviewer"), msg);
  assert.equal(senders.get("fe-reviewer")!.sent.length, 1);
  assert.equal(senders.get("fe-reviewer")!.sent[0]!.id, "m1");
});

test("A2ATransport delivers via the push-webhook when one is configured", async () => {
  const pushed: Array<{ id: string; msg: string }> = [];
  const webhook: WebhookSender = {
    push: async (recipient, m) => { pushed.push({ id: recipient.id, msg: m.id }); },
  };
  const directSends: string[] = [];
  const endpoints: A2AEndpoints = {
    clientFor: () => ({ sendMessage: async (m) => { directSends.push(m.id); return m; } }),
  };
  const t = new A2ATransport(endpoints, webhook);
  await t.deliver(card("fe-reviewer"), msg);
  // webhook is the wake/push path; the direct message/send path is not used
  assert.deepEqual(pushed, [{ id: "fe-reviewer", msg: "m1" }]);
  assert.deepEqual(directSends, []);
});

test("A2ATransport routes delivery through the scheduler when one is injected", async () => {
  const calls: string[] = [];
  const scheduler = {
    run: async <T>(agentId: string, call: () => Promise<T>): Promise<T> => {
      calls.push(agentId);
      return call();
    },
  };
  const sent: string[] = [];
  const endpoints: A2AEndpoints = {
    clientFor: () => ({ sendMessage: async (m) => { sent.push(m.id); return m; } }),
  };
  const t = new A2ATransport(endpoints, undefined, scheduler);
  await t.deliver(card("fe-reviewer"), msg);
  assert.deepEqual(calls, ["fe-reviewer"], "delivery is gated by the scheduler, keyed by recipient");
  assert.deepEqual(sent, ["m1"], "the wrapped call still delivers");
});

test("a real HTTP 429 from the A2A client is retried through the FleetScheduler and then succeeds", async () => {
  class FixedClock implements Clock {
    now(): Date { return new Date("2026-06-06T00:00:00.000Z"); }
    isoNow(): string { return this.now().toISOString(); }
  }
  const slept: number[] = [];
  const sleeper: Sleeper = { sleep: async (ms) => { slept.push(ms); } };

  // HTTP layer: first call -> 429 (Retry-After 2s), then -> a JSON-RPC success.
  let calls = 0;
  const http: HttpClient = {
    request: async (): Promise<HttpResponse> => {
      calls++;
      if (calls === 1) return { status: 429, body: "", headers: { "retry-after": "2" } };
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: msg } }) };
    },
  };

  const scheduler = new FleetScheduler({
    clock: new FixedClock(), sleeper,
    config: { maxConcurrency: 2, bucketCapacity: 1e9, refillPerSec: 1e9 },
  });
  const endpoints: A2AEndpoints = {
    clientFor: () => new A2AClient(http, "http://127.0.0.1:7000"),
  };
  const t = new A2ATransport(endpoints, undefined, scheduler);

  await t.deliver(card("fe-reviewer"), msg);
  assert.equal(calls, 2, "the 429 was retried");
  assert.deepEqual(slept, [2000], "backoff honored the Retry-After hint");
});

test("A2ATransport listen/close are no-ops at this milestone", async () => {
  const t = new A2ATransport({ clientFor: () => new SpySender() });
  await t.listen();
  await t.close();
});
