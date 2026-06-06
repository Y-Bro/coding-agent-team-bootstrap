import type { SocketClient } from "../ports/transport.ts";
import type { Response } from "../broker/protocol.ts";
import type { MessageObserver } from "../broker/broker.ts";
import type { AgentCard, Message, Part } from "../a2a/index.ts";

/**
 * Socket client for the broker RPC. Implements {@link MessageObserver} so a
 * separate-process agent can post its observer copy over the wire (v3-m2), behind
 * the same transport-agnostic seam the in-process broker satisfies.
 */
export class BrokerClient implements MessageObserver {
  constructor(private transport: SocketClient, private socketPath: string) {}

  private async call(method: string, params: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = (await this.transport.request(this.socketPath, { method, params })) as Response;
    } catch {
      throw new Error("broker down — run `team up`");
    }
    if (!res.ok) throw new Error(res.error);
    return res.result;
  }

  send(p: { from: string; to: string; type: string; parts: Part[]; task?: string }): Promise<Message> {
    return this.call("message/send", p) as Promise<Message>;
  }
  /** Post an observer copy of an already-delivered (direct) message to the broker. */
  async observe(message: Message): Promise<void> { await this.call("message/observe", { message }); }
  inbox(agentId: string): Promise<Message[]> { return this.call("inbox/read", { agentId }) as Promise<Message[]>; }
  list(): Promise<AgentCard[]> { return this.call("agent/list", {}) as Promise<AgentCard[]>; }
  register(card: unknown): Promise<void> { return this.call("agent/register", { card }) as Promise<void>; }
}
