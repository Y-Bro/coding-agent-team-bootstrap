import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskMachine } from "../../src/broker/tasks.ts";
import { TaskProjector } from "../../src/broker/task-projector.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { Message } from "../../src/a2a/index.ts";

const m = (over: Partial<Message>): Message => ({
  id: "m", from: "lead", to: "writer", type: "task_assignment",
  parts: [{ kind: "text", text: "Build X" }], ts: "2026-06-07T00:00:00Z", ...over,
});

const setup = () => {
  const store = new JsonlStore(new MemoryFs(), ".team/messages.jsonl");
  const machine = new TaskMachine(store, new FixedClock(), new SeqIds());
  return { machine, projector: new TaskProjector(machine) };
};

test("task_assignment creates the task (by msg.task id) and moves it to working", () => {
  const { machine, projector } = setup();
  projector.handle(m({ task: "t-1" }));
  const t = machine.get("t-1")!;
  assert.equal(t.state, "working");
  assert.equal(t.owner, "writer");   // owner = recipient
  assert.equal(t.title, "Build X");
});

test("approval moves the task to completed", () => {
  const { machine, projector } = setup();
  projector.handle(m({ task: "t-1", type: "review_request" }));
  projector.handle(m({ task: "t-1", type: "approval" }));
  assert.equal(machine.get("t-1")!.state, "completed");
});

test("escalation moves to input-required", () => {
  const { machine, projector } = setup();
  projector.handle(m({ task: "t-1", type: "review_request" }));
  projector.handle(m({ task: "t-1", type: "escalation" }));
  assert.equal(machine.get("t-1")!.state, "input-required");
});

test("messages without msg.task are ignored", () => {
  const { machine, projector } = setup();
  projector.handle(m({ task: undefined }));
  assert.equal(machine.all().length, 0);
});

test("task_status (own output) and unmapped types are ignored", () => {
  const { machine, projector } = setup();
  projector.handle(m({ task: "t-1", type: "task_status" }));
  projector.handle(m({ task: "t-1", type: "note" }));
  assert.equal(machine.all().length, 0);
});

test("a late message after completion does not throw", () => {
  const { machine, projector } = setup();
  projector.handle(m({ task: "t-1", type: "review_request" }));
  projector.handle(m({ task: "t-1", type: "approval" }));
  assert.doesNotThrow(() => projector.handle(m({ task: "t-1", type: "review_request" })));
  assert.equal(machine.get("t-1")!.state, "completed");
});
