import type { AgentCard, Message } from "../a2a/index.ts";
import type { Transport } from "./transport.ts";

/** The slice of an A2A client the transport needs (satisfied by A2AClient). */
export interface A2ASender {
  sendMessage(message: Message): Promise<Message>;
}

/** Resolves the A2A sender for a given recipient (built in the composition root). */
export interface A2AEndpoints {
  clientFor(recipient: AgentCard): A2ASender;
}

/**
 * v2 servers-mode transport: delivers each routed message by pushing it to the
 * recipient agent's A2A HTTP endpoint (`message/send`) via the injected
 * {@link A2AEndpoints} resolver — no panes, no inbox pull. The broker's inbound
 * A2A server is wired in a later milestone, so listen/close are no-ops here.
 */
export class A2ATransport implements Transport {
  constructor(private endpoints: A2AEndpoints) {}

  async deliver(recipient: AgentCard, message: Message): Promise<void> {
    await this.endpoints.clientFor(recipient).sendMessage(message);
  }

  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}
