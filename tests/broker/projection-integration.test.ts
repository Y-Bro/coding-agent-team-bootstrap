import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryBus } from "../../src/broker/bus.ts";
import { TaskMachine, projectTasks } from "../../src/broker/tasks.ts";
import { TaskProjector } from "../../src/broker/task-projector.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { Message } from "../../src/a2a/index.ts";

test("bus -> projector -> store yields live task state via projectTasks", async () => {
  const store = new JsonlStore(new MemoryFs(), ".team/messages.jsonl");
  const bus = new MemoryBus();
  const machine = new TaskMachine(store, new FixedClock(), new SeqIds());
  const projector = new TaskProjector(machine);
  bus.subscribe((m) => projector.handle(m));

  const rr: Message = { id: "m1", task: "t-1", from: "lead", to: "writer",
    type: "review_request", parts: [{ kind: "text", text: "Review" }], ts: "2026-06-07T00:00:00Z" };
  await bus.publish(rr);

  const tasks = projectTasks(store.replay());
  assert.equal(tasks.find((t) => t.id === "t-1")?.state, "working");
});
