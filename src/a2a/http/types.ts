import type { Message } from "../index.ts";

/**
 * A2A-over-HTTP wire contract: an agent exposes its {@link import("../index.ts").AgentCard}
 * at a well-known path and accepts JSON-RPC 2.0 calls at the RPC path. v2-m1
 * implements the `message/send` method; more A2A methods slot in later.
 */
export const A2A_PATHS = {
  /** GET — returns the agent's AgentCard JSON. */
  agentCard: "/.well-known/agent-card.json",
  /** POST — JSON-RPC 2.0 endpoint. */
  rpc: "/a2a",
} as const;

/** The A2A JSON-RPC method this milestone implements. */
export const A2A_METHOD_MESSAGE_SEND = "message/send";

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: R;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcErrorResponse;

/** Standard JSON-RPC error codes used by the A2A endpoint. */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  internalError: -32603,
} as const;

/** `message/send` params: the message to deliver to this agent. */
export interface MessageSendParams {
  message: Message;
}

/** `message/send` result: the agent's accepted/echoed message. */
export interface MessageSendResult {
  message: Message;
}
