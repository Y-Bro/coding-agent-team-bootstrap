import { isMessage, type Message } from "../index.ts";
import { JSON_RPC_ERRORS, type JsonRpcRequest, type MessageSendParams } from "./types.ts";

/** A valid JSON-RPC id is a string or a number (we don't accept null/missing for requests). */
export function isValidId(id: unknown): id is string | number {
  return typeof id === "string" || typeof id === "number";
}

/** Result of validating an inbound JSON-RPC message request: either the message or a JSON-RPC error. */
export interface RpcMessageValidation {
  /** The request id echoed back on the response (null when it was missing/invalid). */
  id: string | number | null;
  message?: Message;
  error?: { code: number; message: string };
}

/**
 * Validate a JSON-RPC 2.0 request body that carries a `params.message`, shared by
 * `message/send` and `message/stream` so both reject malformed envelopes the same
 * way. Returns `{ message }` on success or `{ error }` (with the JSON-RPC error
 * code + the echoed id) otherwise. Auth is intentionally NOT handled here — each
 * route checks its bearer after a valid envelope.
 */
export function validateRpcMessage(body: string, expectedMethod: string): RpcMessageValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { id: null, error: { code: JSON_RPC_ERRORS.parseError, message: "invalid JSON" } };
  }
  if (raw === null || typeof raw !== "object") {
    return { id: null, error: { code: JSON_RPC_ERRORS.invalidRequest, message: "request must be a JSON-RPC object" } };
  }
  const rpc = raw as Partial<JsonRpcRequest>;
  if (!isValidId(rpc.id)) {
    return { id: null, error: { code: JSON_RPC_ERRORS.invalidRequest, message: "missing or invalid id" } };
  }
  const id = rpc.id;
  if (rpc.jsonrpc !== "2.0") {
    return { id, error: { code: JSON_RPC_ERRORS.invalidRequest, message: "jsonrpc must be \"2.0\"" } };
  }
  if (typeof rpc.method !== "string") {
    return { id, error: { code: JSON_RPC_ERRORS.invalidRequest, message: "method must be a string" } };
  }
  if (rpc.method !== expectedMethod) {
    return { id, error: { code: JSON_RPC_ERRORS.methodNotFound, message: `unknown method: ${rpc.method}` } };
  }
  const params = rpc.params as Partial<MessageSendParams> | undefined;
  if (!params || !isMessage(params.message)) {
    return { id, error: { code: JSON_RPC_ERRORS.invalidParams, message: "params.message must be a valid Message" } };
  }
  return { id, message: params.message };
}
