import { test } from "node:test";
import assert from "node:assert/strict";
import { StallPolicy } from "../../../src/broker/policies/stall.ts";
import { TASK_EVENT_TYPE } from "../../../src/broker/tasks.ts";
import { JsonlStore } from "../../../src/broker/store.ts";
import { MemoryFs, SeqIds } from "../../ports/fakes.ts";
import type { Message } from "../../../src/a2a/index.ts";

const store = () => new JsonlStore(new MemoryFs(), ".team/messages.jsonl");

const ev = (taskId: string, state: string, owner: string, ts: string): Message => ({
  id: "e-" + ts, task: taskId, from: "broker", to: "broker", type: TASK_EVENT_TYPE,
  parts: [{ kind: "data", data: { taskId, state, owner } }], ts,
});

test("re-nudges the owner of a task working past stallMs and flags it", () => {
  const s = store();
  s.append(ev("t-1", "working", "writer", "2026-06-07T00:00:00.000Z"));
  const woke: Array<[string, string]> = [];
  const flags: Message[] = [];
  const policy = new StallPolicy({
    store: s, stallMs: 600_000,
    waker: { wake: async (id, summary) => { woke.push([id, summary]); } },
    emit: (m) => flags.push(m),
    ids: new SeqIds(), isoOf: (d) => d.toISOString(),
  });
  policy.run(new Date("2026-06-07T00:11:00.000Z")); // 11 min later
  assert.deepEqual(woke[0]![0], "writer");
  assert.equal(flags.length, 1);
  assert.equal(flags[0]!.type, "stall_flag");
  assert.equal(flags[0]!.to, "writer");
});

test("emits the stall flag only once across consecutive ticks (no re-nudge every sweep)", () => {
  const s = store();
  s.append(ev("t-1", "working", "writer", "2026-06-07T00:00:00.000Z"));
  const woke: string[] = [];
  const flags: Message[] = [];
  // mirror the live path: emit appends the flag to the durable log (emitInternal -> store.append)
  const emit = (m: Message) => { flags.push(m); s.append(m); };
  const policy = new StallPolicy({ store: s, stallMs: 600_000,
    waker: { wake: async (id) => { woke.push(id); } }, emit, ids: new SeqIds(), isoOf: (d) => d.toISOString() });

  policy.run(new Date("2026-06-07T00:11:00.000Z"));
  policy.run(new Date("2026-06-07T00:12:00.000Z")); // still working, same window
  assert.equal(flags.length, 1, "flagged once for the same stall window");
  assert.equal(woke.length, 1, "woke once");
});

test("a newer task_status resets the stall window so a later stall re-flags", () => {
  const s = store();
  s.append(ev("t-1", "working", "writer", "2026-06-07T00:00:00.000Z"));
  const flags: Message[] = [];
  const emit = (m: Message) => { flags.push(m); s.append(m); };
  const policy = new StallPolicy({ store: s, stallMs: 600_000,
    waker: { wake: async () => {} }, emit, ids: new SeqIds(), isoOf: (d) => d.toISOString() });

  policy.run(new Date("2026-06-07T00:11:00.000Z")); // flags once
  // progress: a fresh working status AFTER the flag resets the clock
  s.append(ev("t-1", "working", "writer", "2026-06-07T00:15:00.000Z"));
  policy.run(new Date("2026-06-07T00:26:00.000Z")); // 11 min after the reset -> flags again
  assert.equal(flags.length, 2);
});

test("does not nudge before stallMs", () => {
  const s = store();
  s.append(ev("t-1", "working", "writer", "2026-06-07T00:00:00.000Z"));
  const woke: string[] = [];
  const policy = new StallPolicy({ store: s, stallMs: 600_000,
    waker: { wake: async (id) => { woke.push(id); } }, emit: () => {}, ids: new SeqIds(), isoOf: (d) => d.toISOString() });
  policy.run(new Date("2026-06-07T00:05:00.000Z"));
  assert.equal(woke.length, 0);
});

test("does not nudge a task that has left working (e.g. completed)", () => {
  const s = store();
  s.append(ev("t-1", "working", "writer", "2026-06-07T00:00:00.000Z"));
  s.append(ev("t-1", "completed", "writer", "2026-06-07T00:02:00.000Z"));
  const woke: string[] = [];
  const policy = new StallPolicy({ store: s, stallMs: 600_000,
    waker: { wake: async (id) => { woke.push(id); } }, emit: () => {}, ids: new SeqIds(), isoOf: (d) => d.toISOString() });
  policy.run(new Date("2026-06-07T01:00:00.000Z"));
  assert.equal(woke.length, 0);
});
