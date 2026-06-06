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
 * Push a notification to a recipient's webhook endpoint — the serverful analog
 * of v1's tmux `send-keys` wake. Injected so delivery tests against a fake.
 */
export interface WebhookSender {
  push(recipient: AgentCard, message: Message): Promise<void>;
}

/**
 * v2 servers-mode transport. When a {@link WebhookSender} is configured, delivery
 * pushes each routed message to the recipient's webhook endpoint (the serverful
 * wake); otherwise it falls back to a direct A2A `message/send` via the injected
 * {@link A2AEndpoints} resolver. No panes, no inbox pull. The broker's inbound
 * A2A server is wired in a later milestone, so listen/close are no-ops here.
 */
export class A2ATransport implements Transport {
  constructor(private endpoints: A2AEndpoints, private webhook?: WebhookSender) {}

  async deliver(recipient: AgentCard, message: Message): Promise<void> {
    if (this.webhook) {
      await this.webhook.push(recipient, message);
      return;
    }
    await this.endpoints.clientFor(recipient).sendMessage(message);
  }

  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}
