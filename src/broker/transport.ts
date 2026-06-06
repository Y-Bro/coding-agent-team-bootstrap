import type { AgentCard, Message } from "../a2a/index.ts";
import type { Runtime } from "../runtime/runtime.ts";

/**
 * How the broker gets a routed message to a recipient agent (and runs its
 * inbound side). Mirrors the {@link Runtime} seam — `deliver` + `listen` — so a
 * new delivery strategy drops in without touching routing/registry/feed/the
 * JSONL log. v1 uses the unix-socket pull model (agents pull their inbox; the
 * broker nudges the pane); v2 servers mode pushes over A2A HTTP.
 */
export interface Transport {
  /** Deliver one routed message to one recipient. */
  deliver(recipient: AgentCard, message: Message): Promise<void>;
  /** Start the broker's inbound side (begin accepting messages). */
  listen(): Promise<void>;
  /** Stop the inbound side. */
  close(): Promise<void>;
}

/**
 * v1 transport: agents pull their inbox over the unix socket; delivery just
 * nudges the recipient's pane (via the injected Runtime) to pull. Inbound is the
 * BrokerDaemon's socket server, wired separately in the composition root, so
 * listen/close are no-ops here.
 */
export class SocketTransport implements Transport {
  constructor(private runtime: Runtime) {}

  async deliver(recipient: AgentCard, message: Message): Promise<void> {
    await this.runtime.wake(recipient.id, `${message.type} from ${message.from}`);
  }

  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}
