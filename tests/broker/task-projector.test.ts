import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskProjector } from "../../src/broker/task-projector.ts";
import type { TaskLifecycle } from "../../src/broker/tasks.ts";
import type { Message, Task, TaskState } from "../../src/a2a/index.ts";

const m = (over: Partial<Message>): Message => ({
  id: "m", from: "lead", to: "writer", type: "task_assignment",
  parts: [{ kind: "text", text: "Build X" }], ts: "2026-06-07T00:00:00Z", ...over,
});

/** Minimal in-memory TaskLifecycle fake — no store/clock/ids needed to prove the
 * projector's type→transition mapping. Mirrors TaskMachine's legal-state rules. */
const LEGAL: Record<TaskState, readonly TaskState[]> = {
  submitted: ["working", "canceled"],
  working: ["input-required", "completed", "failed", "canceled"],
  "input-required": ["working", "canceled"],
  completed: [], failed: [], canceled: [],
};
class FakeLifecycle implements TaskLifecycle {
  private tasks = new Map<string, Task>();
  ensure(id: string, input: { title: string; owner: string }): Task {
    const existing = this.tasks.get(id);
    if (existing) return existing;
    const t: Task = { id, title: input.title, state: "submitted", owner: input.owner, history: [], artifacts: [] };
    this.tasks.set(id, t);
    return t;
  }
  transition(id: string, to: TaskState): Task {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`unknown task: ${id}`);
    if (t.state === to) return t;
    if (!LEGAL[t.state].includes(to)) throw new Error(`illegal task transition: ${t.state} -> ${to}`);
    const updated = { ...t, state: to };
    this.tasks.set(id, updated);
    return updated;
  }
  get(id: string): Task | undefined { return this.tasks.get(id); }
  all(): Task[] { return [...this.tasks.values()]; }
}

const setup = () => {
  const machine = new FakeLifecycle();
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
