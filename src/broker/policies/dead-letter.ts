import type { Message } from "../../a2a/index.ts";
import type { MessageStore } from "../store.ts";
import type { IdGenerator } from "../../ports/ids.ts";
import type { SweepPolicy } from "../sweep.ts";

const ANSWER_TYPES = new Set(["approval", "ruling", "review_comment"]);

/** Data payload on an emitted escalation: the dead-lettered request's id. Read
 * back from the log so the "escalate once" guard survives a restart/rebuild. */
interface EscalationMarker { deadLetteredRequestId: string }

export interface DeadLetterDeps {
  store: MessageStore;
  deadLetterMs: number;
  lead: string;
  emit: (m: Message) => void;
  ids: IdGenerator;
  isoOf: (d: Date) => string;
}

/** Escalates review_requests that go unanswered past deadLetterMs to the lead,
 * exactly once each. The once-guard is durable: each escalation records the
 * dead-lettered request id in its data part, and replay skips requests already
 * marked — so a restart/rebuild never re-escalates the same stale request. */
export class DeadLetterPolicy implements SweepPolicy {
  /** Once-guard seeded from durable log markers each run (survives restart) and
   * added to on emit (dedups repeated same-process ticks before the emitted
   * escalation is replayed). */
  private escalated = new Set<string>();
  constructor(private deps: DeadLetterDeps) {}

  run(now: Date): void {
    const log = this.deps.store.replay();
    const requests: Message[] = [];
    const answers: Message[] = [];          // keep timestamps: answers are evaluated per request
    for (const m of log) {
      if (m.type === "review_request" && m.task) requests.push(m);
      else if (m.task && ANSWER_TYPES.has(m.type)) answers.push(m);
      else if (m.type === "escalation") {
        const marker = m.parts.find((p) => p.kind === "data")?.data as EscalationMarker | undefined;
        if (marker?.deadLetteredRequestId) this.escalated.add(marker.deadLetteredRequestId);
      }
    }
    for (const r of requests) {
      if (this.escalated.has(r.id)) continue; // durable once-guard (survives restart)
      // answered only by an answer on the SAME task that arrived AFTER this request
      const reqTs = Date.parse(r.ts);
      const answered = answers.some((a) => a.task === r.task && Date.parse(a.ts) > reqTs);
      if (answered) continue;
      if (now.getTime() - reqTs <= this.deps.deadLetterMs) continue;
      this.escalated.add(r.id); // guard within this run too (and across same-run requests)
      this.deps.emit({
        id: this.deps.ids.next("m"), task: r.task, from: "broker", to: this.deps.lead, type: "escalation",
        parts: [
          { kind: "data", data: { deadLetteredRequestId: r.id } },
          { kind: "text", text: `unanswered review_request ${r.id} (task ${r.task}) dead-lettered to lead` },
        ],
        ts: this.deps.isoOf(now),
      });
    }
  }
}
