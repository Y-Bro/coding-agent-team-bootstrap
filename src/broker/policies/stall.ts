import type { Message } from "../../a2a/index.ts";
import type { MessageStore } from "../store.ts";
import type { IdGenerator } from "../../ports/ids.ts";
import { TASK_EVENT_TYPE } from "../tasks.ts";
import type { SweepPolicy } from "../sweep.ts";
import { trace } from "../../obs/trace.ts";

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
 * and emits a `stall_flag` event ONCE per stall window. The once-guard is durable:
 * each run reads prior stall_flags from the log and skips a task already flagged
 * after its latest task_status, so a fresh task_status (progress) resets the clock
 * and allows a later re-flag, but a steady-state stall is not re-nudged every tick. */
export class StallPolicy implements SweepPolicy {
  constructor(private deps: StallDeps) {}

  run(now: Date): void {
    const latest = new Map<string, { state: string; owner: string; ts: number }>();
    // Latest stall_flag ts per task: the durable once-guard. A flag emitted after
    // the task's latest task_status means this stall window is already flagged.
    const flaggedAt = new Map<string, number>();
    for (const m of this.deps.store.replay()) {
      if (m.type === "stall_flag" && m.task) {
        flaggedAt.set(m.task, Math.max(flaggedAt.get(m.task) ?? 0, Date.parse(m.ts)));
        continue;
      }
      if (m.type !== TASK_EVENT_TYPE || !m.task) continue;
      const data = m.parts.find((p) => p.kind === "data")?.data as { state: string; owner?: string };
      const prev = latest.get(m.task);
      latest.set(m.task, { state: data.state, owner: data.owner ?? prev?.owner ?? "", ts: Date.parse(m.ts) });
    }
    for (const [taskId, t] of latest) {
      if (t.state !== "working") continue;
      if (now.getTime() - t.ts <= this.deps.stallMs) continue;
      // Skip if already flagged for THIS stall window (no newer task_status since).
      const flagTs = flaggedAt.get(taskId);
      if (flagTs !== undefined && flagTs > t.ts) {
        trace("sweep:stall", `task ${taskId} already flagged this window (once-guard) → skip`);
        continue;
      }
      trace("sweep:stall", `task ${taskId} working ${Math.round((now.getTime() - t.ts) / 1000)}s > stallMs → re-nudge owner=${t.owner} + emit stall_flag`);
      void this.deps.waker.wake(t.owner, `task ${taskId} stalled in working`);
      this.deps.emit({
        id: this.deps.ids.next("m"), task: taskId, from: "broker", to: t.owner, type: "stall_flag",
        parts: [{ kind: "text", text: `task ${taskId} has been working too long` }], ts: this.deps.isoOf(now),
      });
    }
  }
}
