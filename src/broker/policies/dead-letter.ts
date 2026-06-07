import type { Message } from "../../a2a/index.ts";
import type { MessageStore } from "../store.ts";
import type { IdGenerator } from "../../ports/ids.ts";
import type { SweepPolicy } from "../sweep.ts";

const ANSWER_TYPES = new Set(["approval", "ruling", "review_comment"]);

export interface DeadLetterDeps {
  store: MessageStore;
  deadLetterMs: number;
  lead: string;
  emit: (m: Message) => void;
  ids: IdGenerator;
  isoOf: (d: Date) => string;
}

/** Escalates review_requests that go unanswered past deadLetterMs to the lead,
 * exactly once each (escalated ids tracked in-process). */
export class DeadLetterPolicy implements SweepPolicy {
  private escalated = new Set<string>();
  constructor(private deps: DeadLetterDeps) {}

  run(now: Date): void {
    const requests: Message[] = [];
    const answeredTasks = new Set<string>();
    for (const m of this.deps.store.replay()) {
      if (m.type === "review_request" && m.task) requests.push(m);
      else if (m.task && ANSWER_TYPES.has(m.type)) answeredTasks.add(m.task);
    }
    for (const r of requests) {
      if (this.escalated.has(r.id)) continue;
      if (r.task && answeredTasks.has(r.task)) continue;
      if (now.getTime() - Date.parse(r.ts) <= this.deps.deadLetterMs) continue;
      this.escalated.add(r.id);
      this.deps.emit({
        id: this.deps.ids.next("m"), task: r.task, from: "broker", to: this.deps.lead, type: "escalation",
        parts: [{ kind: "text", text: `unanswered review_request ${r.id} (task ${r.task}) dead-lettered to lead` }],
        ts: this.deps.isoOf(now),
      });
    }
  }
}
