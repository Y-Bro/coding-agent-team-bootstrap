import type { AgentCard } from "../index.ts";
import type { HttpServer, HttpResponse } from "../../ports/http.ts";
import {
  A2A_PATHS, A2A_METHOD_MESSAGE_SEND, JSON_RPC_ERRORS,
  type JsonRpcRequest, type MessageSendParams, type MessageSendResult,
} from "./types.ts";

/** The application logic an A2A server delegates to (handles received messages). */
export interface A2ARequestHandler {
  onMessageSend(params: MessageSendParams): Promise<MessageSendResult> | MessageSendResult;
}

function json(status: number, value: unknown): HttpResponse {
  return { status, body: JSON.stringify(value) };
}

/**
 * Exposes one agent over A2A-over-HTTP: its AgentCard at the well-known path and
 * a JSON-RPC 2.0 `message/send` endpoint. Transport is the injected HttpServer;
 * application behavior is the injected handler.
 */
export class A2AServer {
  constructor(
    private http: HttpServer,
    private card: AgentCard,
    private handler: A2ARequestHandler,
  ) {}

  /** Register the agent-card and RPC routes on the injected HttpServer. */
  register(): void {
    this.http.route("GET", A2A_PATHS.agentCard, () => json(200, this.card));
    this.http.route("POST", A2A_PATHS.rpc, async (req) => {
      let rpc: JsonRpcRequest;
      try {
        rpc = JSON.parse(req.body) as JsonRpcRequest;
      } catch {
        return json(200, this.error(null, JSON_RPC_ERRORS.parseError, "invalid JSON"));
      }
      if (rpc.method !== A2A_METHOD_MESSAGE_SEND) {
        return json(200, this.error(rpc.id, JSON_RPC_ERRORS.methodNotFound, `unknown method: ${rpc.method}`));
      }
      try {
        const result = await this.handler.onMessageSend(rpc.params as MessageSendParams);
        return json(200, { jsonrpc: "2.0", id: rpc.id, result });
      } catch (e) {
        return json(200, this.error(rpc.id, JSON_RPC_ERRORS.internalError, e instanceof Error ? e.message : String(e)));
      }
    });
  }

  /** Start listening on the given port (delegates to the injected server). */
  async listen(port: number): Promise<void> { await this.http.listen(port); }
  async close(): Promise<void> { await this.http.close(); }

  private error(id: JsonRpcRequest["id"] | null, code: number, message: string) {
    return { jsonrpc: "2.0" as const, id, error: { code, message } };
  }
}
