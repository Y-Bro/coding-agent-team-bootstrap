import { test } from "node:test";
import assert from "node:assert/strict";
import { DeadLetterPolicy } from "../../../src/broker/policies/dead-letter.ts";
import { JsonlStore } from "../../../src/broker/store.ts";
import { MemoryFs, SeqIds } from "../../ports/fakes.ts";
import type { Message } from "../../../src/a2a/index.ts";

const store = () => new JsonlStore(new MemoryFs(), ".team/messages.jsonl");

const rr = (id: string, task: string, ts: string): Message => ({
  id, task, from: "writer", to: "reviewer", type: "review_request",
  parts: [{ kind: "text", text: "review" }], ts,
});

test("escalates an unanswered review_request past deadLetterMs, once", () => {
  const s = store();
  s.append(rr("m1", "t-1", "2026-06-07T00:00:00.000Z"));
  const sent: Message[] = [];
  const policy = new DeadLetterPolicy({ store: s, deadLetterMs: 1_800_000, lead: "lead",
    emit: (m) => sent.push(m), ids: new SeqIds(), isoOf: (d) => d.toISOString() });
  policy.run(new Date("2026-06-07T00:31:00.000Z")); // 31 min
  policy.run(new Date("2026-06-07T00:40:00.000Z")); // again
  assert.equal(sent.length, 1);              // escalated exactly once
  assert.equal(sent[0]!.type, "escalation");
  assert.equal(sent[0]!.to, "lead");
});

test("does not escalate an answered review_request", () => {
  const s = store();
  s.append(rr("m1", "t-1", "2026-06-07T00:00:00.000Z"));
  s.append({ id: "m2", task: "t-1", from: "reviewer", to: "writer", type: "approval",
    parts: [{ kind: "text", text: "ok" }], ts: "2026-06-07T00:05:00.000Z" });
  const sent: Message[] = [];
  const policy = new DeadLetterPolicy({ store: s, deadLetterMs: 1_800_000, lead: "lead",
    emit: (m) => sent.push(m), ids: new SeqIds(), isoOf: (d) => d.toISOString() });
  policy.run(new Date("2026-06-07T01:00:00.000Z"));
  assert.equal(sent.length, 0);
});

test("does not escalate before deadLetterMs", () => {
  const s = store();
  s.append(rr("m1", "t-1", "2026-06-07T00:00:00.000Z"));
  const sent: Message[] = [];
  const policy = new DeadLetterPolicy({ store: s, deadLetterMs: 1_800_000, lead: "lead",
    emit: (m) => sent.push(m), ids: new SeqIds(), isoOf: (d) => d.toISOString() });
  policy.run(new Date("2026-06-07T00:20:00.000Z")); // 20 min < 30
  assert.equal(sent.length, 0);
});
