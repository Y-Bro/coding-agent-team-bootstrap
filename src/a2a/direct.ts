import type { Message } from "./index.ts";
import type { AgentDirectory } from "../broker/registry.ts";
import type { MessageRouter } from "../broker/router.ts";
import type { A2AEndpoints } from "../broker/a2a-transport.ts";
import type { MessageObserver, SendInput } from "../broker/broker.ts";
import type { Clock } from "../ports/clock.ts";
import type { IdGenerator } from "../ports/ids.ts";

/** The agent-side messaging entry point (mirror of broker-mediated send). */
export interface Messenger {
  send(input: SendInput): Promise<Message>;
}

export interface DirectMessengerDeps {
  /** Local copy of the Agent Cards the broker publishes (for client-side resolution). */
  directory: AgentDirectory;
  /** Resolves to/type → recipient ids (same rule as the broker: id/role/capability/subscription). */
  router: MessageRouter;
  /** Per-recipient A2A clients for peer-to-peer message/send. */
  endpoints: A2AEndpoints;
  /** The broker's observer — gets a copy so the durable log + feed stay complete. */
  observer: MessageObserver;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * v3 direct delivery (LEAD DECISION Q1 = COEXIST). The sending agent resolves
 * recipients CLIENT-SIDE from the published Agent Cards and delivers each one
 * peer-to-peer over A2A `message/send` — the broker is NOT in the delivery path.
 * The broker still sees every message: a single observer copy (same id/ts as the
 * delivered message) is posted to it, so the JSONL log, feed, and rebuild are
 * unchanged. Drop-in alternative to broker-mediated send behind the
 * {@link Messenger} seam; broker-mediated remains the default.
 */
export class DirectMessenger implements Messenger {
  constructor(private deps: DirectMessengerDeps) {}

  async send(input: SendInput): Promise<Message> {
    const m: Message = {
      id: this.deps.ids.next("m"),
      task: input.task,
      from: input.from,
      to: input.to,
      type: input.type,
      parts: input.parts,
      ts: this.deps.clock.isoNow(),
    };
    // Deliver peer-to-peer to every resolved recipient (no broker in the path).
    for (const id of this.deps.router.resolve(input.to, input.type)) {
      const card = this.deps.directory.get(id);
      if (card) await this.deps.endpoints.clientFor(card).sendMessage(m);
    }
    // One observer copy so the broker's durable log + feed stay complete.
    await this.deps.observer.observe(m);
    return m;
  }
}
