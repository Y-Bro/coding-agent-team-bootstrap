import { test } from "node:test";
import assert from "node:assert/strict";
import { A2ATransport, type A2ASender, type A2AEndpoints, type WebhookSender } from "../../src/broker/a2a-transport.ts";
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

test("A2ATransport listen/close are no-ops at this milestone", async () => {
  const t = new A2ATransport({ clientFor: () => new SpySender() });
  await t.listen();
  await t.close();
});
