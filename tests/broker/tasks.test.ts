import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskMachine } from "../../src/broker/tasks.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { TaskState } from "../../src/a2a/index.ts";

function machine() {
  const fs = new MemoryFs();
  const store = new JsonlStore(fs, ".team/messages.jsonl");
  return { store, m: new TaskMachine(store, new FixedClock(), new SeqIds()), fs };
}

test("create starts a task in the submitted state", () => {
  const { m } = machine();
  const t = m.create({ title: "slice 4", owner: "fe-writer" });
  assert.equal(t.state, "submitted");
  assert.equal(t.title, "slice 4");
  assert.equal(t.owner, "fe-writer");
  assert.equal(m.get(t.id)!.state, "submitted");
});

const legal: Array<[TaskState, TaskState]> = [
  ["submitted", "working"],
  ["submitted", "canceled"],
  ["working", "input-required"],
  ["working", "completed"],
  ["working", "failed"],
  ["working", "canceled"],
  ["input-required", "working"],
  ["input-required", "canceled"],
];

for (const [from, to] of legal) {
  test(`legal transition ${from} -> ${to}`, () => {
    const { m } = machine();
    const t = m.create({ title: "x", owner: "o" });
    // drive to `from`
    if (from === "working") m.transition(t.id, "working");
    if (from === "input-required") { m.transition(t.id, "working"); m.transition(t.id, "input-required"); }
    const out = m.transition(t.id, to);
    assert.equal(out.state, to);
    assert.equal(m.get(t.id)!.state, to);
  });
}

const illegal: Array<[TaskState, TaskState]> = [
  ["submitted", "completed"],
  ["submitted", "input-required"],
  ["working", "submitted"],
  ["completed", "working"],
  ["failed", "working"],
  ["canceled", "working"],
];

for (const [from, to] of illegal) {
  test(`illegal transition ${from} -> ${to} is rejected`, () => {
    const { m } = machine();
    const t = m.create({ title: "x", owner: "o" });
    if (from === "working") m.transition(t.id, "working");
    if (from === "completed") { m.transition(t.id, "working"); m.transition(t.id, "completed"); }
    if (from === "failed") { m.transition(t.id, "working"); m.transition(t.id, "failed"); }
    if (from === "canceled") m.transition(t.id, "canceled");
    assert.throws(() => m.transition(t.id, to), /illegal task transition/);
  });
}

test("transition on an unknown task throws", () => {
  const { m } = machine();
  assert.throws(() => m.transition("nope", "working"), /unknown task/);
});

test("ensure creates a task with the given id once, idempotently", () => {
  const { m } = machine();
  const a = m.ensure("t-1", { title: "T", owner: "writer" });
  const b = m.ensure("t-1", { title: "OTHER", owner: "x" });
  assert.equal(a.id, "t-1");
  assert.equal(b.title, "T");                    // second ensure is a no-op
  assert.equal(m.all().length, 1);
});

test("transition to the current state is an idempotent no-op (no throw)", () => {
  const { m } = machine();
  m.ensure("t-1", { title: "T", owner: "w" });
  m.transition("t-1", "working");
  const again = m.transition("t-1", "working");  // same state
  assert.equal(again.state, "working");
});

test("genuinely illegal transition still throws", () => {
  const { m } = machine();
  m.ensure("t-1", { title: "T", owner: "w" });
  m.transition("t-1", "working");
  m.transition("t-1", "completed");
  assert.throws(() => m.transition("t-1", "working")); // completed is terminal
});

test("replay reconstructs task state from the persisted log", () => {
  const { store, m } = machine();
  const t = m.create({ title: "ship", owner: "lead" });
  m.transition(t.id, "working");
  m.transition(t.id, "input-required");
  m.transition(t.id, "working");
  m.transition(t.id, "completed");

  // a fresh machine over the SAME store rebuilds the final state
  const m2 = new TaskMachine(store, new FixedClock(), new SeqIds());
  m2.rebuild();
  const rebuilt = m2.get(t.id)!;
  assert.equal(rebuilt.state, "completed");
  assert.equal(rebuilt.title, "ship");
  assert.equal(rebuilt.owner, "lead");
});

test("replay reconstructs multiple tasks", () => {
  const { store, m } = machine();
  const a = m.create({ title: "a", owner: "x" });
  const b = m.create({ title: "b", owner: "y" });
  m.transition(a.id, "working");
  m.transition(b.id, "canceled");

  const m2 = new TaskMachine(store, new FixedClock(), new SeqIds());
  m2.rebuild();
  assert.equal(m2.get(a.id)!.state, "working");
  assert.equal(m2.get(b.id)!.state, "canceled");
  assert.equal(m2.all().length, 2);
});
