import type { AgentCard, Message, Part } from "../a2a/index.ts";
import type { MessageStore } from "./store.ts";
import type { AgentDirectory } from "./registry.ts";
import type { MessageRouter } from "./router.ts";
import type { FeedWriter } from "./feed.ts";
import type { Transport } from "./transport.ts";
import type { Clock } from "../ports/clock.ts";
import type { IdGenerator } from "../ports/ids.ts";

export interface SendInput {
  from: string;
  to: string;
  type: string;
  parts: Part[];
  task?: string;
}

export interface BrokerDeps {
  store: MessageStore;
  registry: AgentDirectory;
  router: MessageRouter;
  feed: FeedWriter;
  transport: Transport;
  clock: Clock;
  ids: IdGenerator;
}

/** Narrow dispatch surface the daemon drives over the wire protocol. */
export interface BrokerDispatch {
  register(card: AgentCard): void;
  agents(): AgentCard[];
  send(input: SendInput): Promise<Message>;
  /** Record a peer-to-peer-delivered message (observer role, not in delivery path). */
  observe(message: Message): Promise<void>;
  inbox(agentId: string): Message[];
}

/**
 * The broker's observer role (v3 COEXIST, Q1): record a message that was already
 * delivered peer-to-peer so the durable log + feed + inbox state stay complete,
 * WITHOUT the broker being in the delivery path. Satisfied by {@link Broker}.
 */
export interface MessageObserver {
  observe(message: Message): Promise<void>;
}

export class Broker implements BrokerDispatch, MessageObserver {
  private inboxes = new Map<string, Message[]>();

  constructor(private deps: BrokerDeps) {}

  register(card: AgentCard): void { this.deps.registry.register(card); }
  agents(): AgentCard[] { return this.deps.registry.all(); }

  async send(input: SendInput): Promise<Message> {
    const recipients = this.deps.router.resolve(input.to, input.type);
    const m: Message = {
      id: this.deps.ids.next("m"),
      task: input.task,
      from: input.from,
      to: input.to,
      type: input.type,
      parts: input.parts,
      ts: this.deps.clock.isoNow(),
    };
    this.record(m, recipients);
    for (const id of recipients) {
      const card = this.deps.registry.get(id);
      if (card) await this.deps.transport.deliver(card, m);
    }
    return m;
  }

  /**
   * Observe a message already delivered peer-to-peer (v3 direct mode): persist
   * it to the durable log + feed and track inbox state for parity — but do NOT
   * deliver it over the transport (the broker is the observer, not in the path).
   */
  async observe(m: Message): Promise<void> {
    this.record(m, this.safeResolve(m.to, m.type));
  }

  /** Drain and return this agent's pending messages. */
  inbox(agentId: string): Message[] {
    const msgs = this.inboxes.get(agentId) ?? [];
    this.inboxes.set(agentId, []);
    return msgs;
  }

  /** Rebuild inbox state by replaying the persisted log (no re-wake, no re-append). */
  rebuild(): void {
    this.inboxes.clear();
    for (const m of this.deps.store.replay()) {
      for (const id of this.safeResolve(m.to, m.type)) this.deliver(id, m);
    }
  }

  private safeResolve(to: string, type: string): string[] {
    try { return this.deps.router.resolve(to, type); } catch { return []; }
  }

  /** Persist + feed a message and push it into each recipient's inbox (no transport). */
  private record(m: Message, recipients: string[]): void {
    this.deps.store.append(m);
    this.deps.feed.append(m);
    for (const id of recipients) this.deliver(id, m);
  }

  private deliver(id: string, m: Message): void {
    const box = this.inboxes.get(id) ?? [];
    box.push(m);
    this.inboxes.set(id, box);
  }
}
