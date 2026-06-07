import type { Message } from "../../a2a/index.ts";
import type { MessageStore } from "../store.ts";
import type { IdGenerator } from "../../ports/ids.ts";
import { TASK_EVENT_TYPE } from "../tasks.ts";
import type { SweepPolicy } from "../sweep.ts";

/** Narrow nudge seam (the runtime's waker). */
export interface Nudger { wake(agentId: string, summary: string): Promise<void>; }

export interface StallDeps {
  store: MessageStore;
  stallMs: number;
  waker: Nudger;
  emit: (m: Message) => void;   // append+publish a flag event
  ids: IdGenerator;
  isoOf: (d: Date) => string;
}

/** Re-nudges the owner of any task that has been `working` longer than stallMs,
 * and emits a `stall_flag` event. Idempotent per stall window is acceptable —
 * a fresh task_status (e.g. on progress) resets the clock. */
export class StallPolicy implements SweepPolicy {
  constructor(private deps: StallDeps) {}

  run(now: Date): void {
    const latest = new Map<string, { state: string; owner: string; ts: number }>();
    for (const m of this.deps.store.replay()) {
      if (m.type !== TASK_EVENT_TYPE || !m.task) continue;
      const data = m.parts.find((p) => p.kind === "data")?.data as { state: string; owner?: string };
      const prev = latest.get(m.task);
      latest.set(m.task, { state: data.state, owner: data.owner ?? prev?.owner ?? "", ts: Date.parse(m.ts) });
    }
    for (const [taskId, t] of latest) {
      if (t.state !== "working") continue;
      if (now.getTime() - t.ts <= this.deps.stallMs) continue;
      void this.deps.waker.wake(t.owner, `task ${taskId} stalled in working`);
      this.deps.emit({
        id: this.deps.ids.next("m"), task: taskId, from: "broker", to: t.owner, type: "stall_flag",
        parts: [{ kind: "text", text: `task ${taskId} has been working too long` }], ts: this.deps.isoOf(now),
      });
    }
  }
}
