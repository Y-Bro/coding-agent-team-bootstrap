import type { MessageStore } from "./store.ts";
import type { Clock } from "../ports/clock.ts";
import type { IdGenerator } from "../ports/ids.ts";
import type { Message, Task, TaskState } from "../a2a/index.ts";
import { trace } from "../obs/trace.ts";

/** Message type used to persist task lifecycle events in the shared JSONL log. */
export const TASK_EVENT_TYPE = "task_status";

/** Legal A2A task transitions; terminal states (completed/failed/canceled) have none. */
const LEGAL_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  submitted: ["working", "canceled"],
  working: ["input-required", "completed", "failed", "canceled"],
  "input-required": ["working", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

interface TaskEvent {
  taskId: string;
  state: TaskState;
  title?: string;
  owner?: string;
}

function taskEventOf(m: Message): TaskEvent | undefined {
  if (m.type !== TASK_EVENT_TYPE) return undefined;
  const part = m.parts.find((p) => p.kind === "data");
  if (!part || part.kind !== "data") return undefined;
  return part.data as TaskEvent;
}

/**
 * Derive current task state from a message log: each `task_status` event sets a
 * task's latest state (title/owner carried forward). Pure read-only projection,
 * shared by {@link TaskMachine.rebuild} and the read-only dashboard.
 */
export function projectTasks(messages: Iterable<Message>): Task[] {
  const tasks = new Map<string, Task>();
  for (const m of messages) {
    const ev = taskEventOf(m);
    if (!ev) continue;
    const existing = tasks.get(ev.taskId);
    tasks.set(ev.taskId, {
      id: ev.taskId,
      title: ev.title ?? existing?.title ?? "",
      owner: ev.owner ?? existing?.owner ?? "",
      state: ev.state,
      history: [],
      artifacts: [],
    });
  }
  return [...tasks.values()];
}

/**
 * Narrow task-lifecycle seam the {@link TaskProjector} depends on: create-if-absent
 * and state transition only. Lets the projector observe traffic without depending on
 * the concrete {@link TaskMachine} (store/clock/ids). Satisfied by {@link TaskMachine}.
 */
export interface TaskLifecycle {
  ensure(id: string, input: { title: string; owner: string }): Task;
  transition(taskId: string, to: TaskState): Task;
}

/**
 * The A2A Task lifecycle, persisted over the existing v1 {@link MessageStore}:
 * every create/transition is appended as a `task_status` message, so replaying
 * the log reconstructs task state (rebuild-from-log preserved). Illegal
 * transitions are rejected; terminal states accept none.
 */
export class TaskMachine implements TaskLifecycle {
  private tasks = new Map<string, Task>();

  constructor(private store: MessageStore, private clock: Clock, private ids: IdGenerator) {}

  /** Create a new task in the `submitted` state and persist the event. */
  create(input: { title: string; owner: string }): Task {
    const id = this.ids.next("t");
    const task: Task = { id, title: input.title, state: "submitted", owner: input.owner, history: [], artifacts: [] };
    this.tasks.set(id, task);
    this.record({ taskId: id, state: "submitted", title: input.title, owner: input.owner });
    return task;
  }

  /** Create a task with a caller-supplied id in `submitted` if absent; else no-op. */
  ensure(id: string, input: { title: string; owner: string }): Task {
    const existing = this.tasks.get(id);
    if (existing) return existing;
    trace("tasks", `ensure ${id}: create in 'submitted' (owner=${input.owner})`);
    const task: Task = { id, title: input.title, state: "submitted", owner: input.owner, history: [], artifacts: [] };
    this.tasks.set(id, task);
    this.record({ taskId: id, state: "submitted", title: input.title, owner: input.owner });
    return task;
  }

  /** Move a task to a new state, rejecting illegal transitions; persists the event. */
  transition(taskId: string, to: TaskState): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`unknown task: ${taskId}`);
    if (task.state === to) return task; // idempotent: re-applying the same state is a no-op
    if (!LEGAL_TRANSITIONS[task.state].includes(to)) {
      throw new Error(`illegal task transition: ${task.state} -> ${to}`);
    }
    trace("tasks", `transition ${taskId}: ${task.state} → ${to}`);
    const updated: Task = { ...task, state: to };
    this.tasks.set(taskId, updated);
    this.record({ taskId, state: to });
    return updated;
  }

  get(taskId: string): Task | undefined { return this.tasks.get(taskId); }
  all(): Task[] { return [...this.tasks.values()]; }

  /** Reconstruct all task state by replaying the persisted log (no re-record). */
  rebuild(): void {
    this.tasks.clear();
    for (const t of projectTasks(this.store.replay())) this.tasks.set(t.id, t);
  }

  private record(ev: TaskEvent): void {
    const m: Message = {
      id: this.ids.next("m"),
      task: ev.taskId,
      from: "broker",
      to: "broker",
      type: TASK_EVENT_TYPE,
      parts: [{ kind: "data", data: ev }],
      ts: this.clock.isoNow(),
    };
    this.store.append(m);
  }
}
