import { type SocketServer, BrokerAlreadyRunningError } from "../ports/transport.ts";
import type { BrokerDispatch } from "./broker.ts";
import type { Request, Response } from "./protocol.ts";

/** Bridges the socket transport to the broker dispatch surface. Pure dispatch, injectable server. */
export class BrokerDaemon {
  constructor(private broker: BrokerDispatch, private server: SocketServer) {}

  async start(socketPath: string): Promise<void> {
    try {
      await this.server.listen(socketPath, (raw, reply) => {
        void this.handle(raw as Request).then(reply);
      });
    } catch (e) {
      // Normalize any raw bind collision into the clear "already running" signal.
      if (e instanceof BrokerAlreadyRunningError) throw e;
      if ((e as NodeJS.ErrnoException)?.code === "EADDRINUSE") throw new BrokerAlreadyRunningError();
      throw e;
    }
  }

  async stop(): Promise<void> {
    await this.server.close();
  }

  private async handle(req: Request): Promise<Response> {
    try {
      switch (req.method) {
        case "agent/register":
          this.broker.register(req.params.card);
          return { ok: true, result: null };
        case "agent/list":
          return { ok: true, result: this.broker.agents() };
        case "message/send":
          return { ok: true, result: await this.broker.send(req.params) };
        case "message/observe":
          await this.broker.observe(req.params.message);
          return { ok: true, result: null };
        case "inbox/peek":
          return { ok: true, result: this.broker.peek(req.params.agentId) };
        case "inbox/ack":
          this.broker.ack(req.params.agentId, req.params.ids);
          return { ok: true, result: null };
        default:
          return { ok: false, error: `unknown method` };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
