import type { AgentCard, Message } from "../a2a/index.ts";
import type { Transport } from "./transport.ts";
import type { RuntimeKind } from "../runtime/composite.ts";
import { trace } from "../obs/trace.ts";

/**
 * v3 mixed-runtime bridge (LEAD DECISION Q2). The broker delivers every routed
 * message through the transport that matches the RECIPIENT's runtime — a pane
 * recipient is woken over the unix socket, a server recipient is pushed over A2A
 * HTTP — so a pane agent and a server agent exchange messages transparently in
 * both directions. Sits behind the {@link Transport} seam; the broker is unaware
 * delivery is bridged.
 */
export class CompositeTransport implements Transport {
  constructor(
    private transports: Record<RuntimeKind, Transport>,
    private resolve: (recipient: AgentCard) => RuntimeKind,
  ) {}

  async deliver(recipient: AgentCard, message: Message): Promise<void> {
    const kind = this.resolve(recipient);
    trace("composite-transport", `route ${message.id} → ${recipient.id} via ${kind} transport`);
    await this.transports[kind].deliver(recipient, message);
  }

  async listen(): Promise<void> {
    for (const t of new Set(Object.values(this.transports))) await t.listen();
  }

  async close(): Promise<void> {
    for (const t of new Set(Object.values(this.transports))) await t.close();
  }
}
