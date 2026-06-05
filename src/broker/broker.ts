import type { AgentCard, Message, Part } from "../a2a/index.ts";
import type { MessageStore } from "./store.ts";
import type { AgentDirectory } from "./registry.ts";
import type { MessageRouter } from "./router.ts";
import type { FeedWriter } from "./feed.ts";
import type { Runtime } from "../runtime/runtime.ts";
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
  runtime: Runtime;
  clock: Clock;
  ids: IdGenerator;
}

export class Broker {
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
    this.deps.store.append(m);
    this.deps.feed.append(m);
    for (const id of recipients) {
      this.deliver(id, m);
      await this.deps.runtime.wake(id, `${m.type} from ${m.from}`);
    }
    return m;
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

  private deliver(id: string, m: Message): void {
    const box = this.inboxes.get(id) ?? [];
    box.push(m);
    this.inboxes.set(id, box);
  }
}
