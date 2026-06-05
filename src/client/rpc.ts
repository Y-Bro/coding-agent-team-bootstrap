import type { SocketClient } from "../ports/transport.ts";
import type { Response } from "../broker/protocol.ts";
import type { Part } from "../a2a/index.ts";

export class BrokerClient {
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

  send(p: { from: string; to: string; type: string; parts: Part[]; task?: string }) {
    return this.call("message/send", p);
  }
  inbox(agentId: string) { return this.call("inbox/read", { agentId }); }
  list() { return this.call("agent/list", {}); }
  register(card: unknown) { return this.call("agent/register", { card }); }
}
