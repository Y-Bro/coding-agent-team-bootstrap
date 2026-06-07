import type { Message, TaskState } from "../a2a/index.ts";
import type { TaskMachine } from "./tasks.ts";

/** Message type → task state. Only these types affect task lifecycle; everything
 * else (including the projector's own `task_status` output) is ignored. */
const TYPE_TO_STATE: Readonly<Record<string, TaskState>> = {
  task_assignment: "working",
  review_request: "working",
  approval: "completed",
  ruling: "completed",
  escalation: "input-required",
};

function titleOf(m: Message): string {
  const text = m.parts.find((p) => p.kind === "text");
  return text && text.kind === "text" ? text.text.slice(0, 80) : m.type;
}

/**
 * Observes recorded messages off the bus and derives A2A task state via the
 * TaskMachine. Strictly observational — never on the send/delivery path. Acts
 * only on messages that carry a `task` id; tolerant of duplicate and late
 * messages (idempotent + try/catch), satisfying the bus adapter contract.
 */
export class TaskProjector {
  constructor(private machine: TaskMachine) {}

  handle(m: Message): void {
    if (!m.task) return;
    const to = TYPE_TO_STATE[m.type];
    if (!to) return;
    this.machine.ensure(m.task, { title: titleOf(m), owner: m.to });
    try {
      this.machine.transition(m.task, to);
    } catch {
      // A late/out-of-order message proposing an illegal transition (e.g. after a
      // terminal state) is ignored — the bus is at-least-once and unordered.
    }
  }
}
