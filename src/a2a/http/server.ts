import type { AgentCard } from "../index.ts";
import type { HttpServer, HttpResponse } from "../../ports/http.ts";
import {
  A2A_PATHS, A2A_METHOD_MESSAGE_SEND, JSON_RPC_ERRORS,
  type JsonRpcRequest, type MessageSendParams, type MessageSendResult,
} from "./types.ts";
import { authorize, type AuthProvider } from "./auth.ts";
import { validateRpcMessage } from "./rpc-validate.ts";

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
    private auth?: AuthProvider,
  ) {}

  /** Register the agent-card and RPC routes on the injected HttpServer. */
  register(): void {
    this.http.route("GET", A2A_PATHS.agentCard, () => json(200, this.card));
    this.http.route("POST", A2A_PATHS.rpc, async (req) => {
      // Shared JSON-RPC envelope + message validation (identical for message/stream).
      const v = validateRpcMessage(req.body, A2A_METHOD_MESSAGE_SEND);
      if (v.error) return json(200, this.error(v.id, v.error.code, v.error.message));

      // Require + validate the bearer token when an AuthProvider is configured.
      if (this.auth && !authorize(req.headers, this.auth).ok) {
        return json(200, this.error(v.id, JSON_RPC_ERRORS.unauthorized, "missing or invalid bearer token"));
      }

      try {
        const result = await this.handler.onMessageSend({ message: v.message! });
        return json(200, { jsonrpc: "2.0", id: v.id, result });
      } catch (e) {
        return json(200, this.error(v.id, JSON_RPC_ERRORS.internalError, e instanceof Error ? e.message : String(e)));
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
