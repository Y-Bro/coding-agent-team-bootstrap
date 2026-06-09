import type { AgentCard, Message, Part } from "../a2a/index.ts";
import type { MessageStore } from "./store.ts";
import type { AgentDirectory } from "./registry.ts";
import type { MessageRouter } from "./router.ts";
import type { FeedWriter } from "./feed.ts";
import type { Transport } from "./transport.ts";
import type { MessagePublisher } from "./bus.ts";
import type { Clock } from "../ports/clock.ts";
import type { IdGenerator } from "../ports/ids.ts";

/** Log record type marking messages an agent has consumed (the delivery watermark). */
export const ACK_EVENT_TYPE = "inbox_ack";

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
  /** Optional observer fan-out (read-only dashboard); notified of every recorded message. */
  publisher?: MessagePublisher;
}

/** Narrow dispatch surface the daemon drives over the wire protocol. */
export interface BrokerDispatch {
  register(card: AgentCard): void;
  agents(): AgentCard[];
  send(input: SendInput): Promise<Message>;
  /** Record a peer-to-peer-delivered message (observer role, not in delivery path). */
  observe(message: Message): Promise<void>;
  peek(agentId: string): Message[];
  ack(agentId: string, ids: string[]): void;
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
    await this.deliverAll(m, recipients);
    return m;
  }

  /**
   * Emit a fully-formed broker-internal message (e.g. a sweep policy flag /
   * escalation) through the SAME path as a normal send, so it is visible in
   * team inbox + feed (and wakes the recipient), not just the durable log.
   */
  async emitInternal(m: Message): Promise<void> {
    const recipients = this.safeResolve(m.to, m.type);
    this.record(m, recipients);
    await this.deliverAll(m, recipients);
  }

  /** Best-effort wake/forward to each recipient over the transport. */
  private async deliverAll(m: Message, recipients: string[]): Promise<void> {
    for (const id of recipients) {
      const card = this.deps.registry.get(id);
      if (card) await this.deps.transport.deliver(card, m);
    }
  }

  /**
   * Observe a message already delivered peer-to-peer (v3 direct mode): persist
   * it to the durable log + feed and track inbox state for parity — but do NOT
   * deliver it over the transport (the broker is the observer, not in the path).
   */
  async observe(m: Message): Promise<void> {
    this.record(m, this.safeResolve(m.to, m.type));
  }

  /** Non-destructive read of this agent's pending messages. */
  peek(agentId: string): Message[] {
    return [...(this.inboxes.get(agentId) ?? [])];
  }

  /** Mark messages consumed: drop them from the inbox and persist an ack record
   * so the watermark survives a restart (rebuild skips acked ids). */
  ack(agentId: string, ids: string[]): void {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const box = (this.inboxes.get(agentId) ?? []).filter((m) => !drop.has(m.id));
    this.inboxes.set(agentId, box);
    this.deps.store.append({
      id: this.deps.ids.next("m"), from: agentId, to: "broker", type: ACK_EVENT_TYPE,
      parts: [{ kind: "data", data: { agentId, ids } }], ts: this.deps.clock.isoNow(),
    });
  }

  /** Rebuild inbox state from the log, honoring ack records (no re-delivery of
   * already-consumed messages). Acks always follow their messages chronologically,
   * so a single in-order pass is correct. */
  rebuild(): void {
    this.inboxes.clear();
    for (const m of this.deps.store.replay()) {
      if (m.type === ACK_EVENT_TYPE) {
        const { agentId, ids } = m.parts.find((p) => p.kind === "data")?.data as { agentId: string; ids: string[] };
        const drop = new Set(ids);
        this.inboxes.set(agentId, (this.inboxes.get(agentId) ?? []).filter((x) => !drop.has(x.id)));
        continue;
      }
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
    void this.deps.publisher?.publish(m); // notify observers (dashboard/projector/sweep) — fire-and-forget so record() stays sync
  }

  private deliver(id: string, m: Message): void {
    const box = this.inboxes.get(id) ?? [];
    box.push(m);
    this.inboxes.set(id, box);
  }
}
