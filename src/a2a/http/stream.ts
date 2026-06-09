import type { HttpServer, HttpClient } from "../../ports/http.ts";
import type { Message } from "../index.ts";
import { A2A_PATHS, A2A_METHOD_MESSAGE_STREAM, JSON_RPC_ERRORS } from "./types.ts";
import { authorize, bearerHeader, type AuthProvider } from "./auth.ts";
import { throwIfRateLimited } from "./ratelimit.ts";
import { validateRpcMessage } from "./rpc-validate.ts";

/** Content type for an SSE response. */
export const SSE_CONTENT_TYPE = "text/event-stream";

/** One Server-Sent Event: an optional event name + a JSON data payload. */
export interface StreamEvent {
  event?: string;
  data: unknown;
}

/** Encode a single event as an SSE frame (terminated by a blank line). */
export function encodeSseFrame(ev: StreamEvent): string {
  const lines: string[] = [];
  if (ev.event !== undefined) lines.push(`event: ${ev.event}`);
  lines.push(`data: ${JSON.stringify(ev.data)}`);
  return lines.join("\n") + "\n\n";
}

/** Encode a sequence of events into a full SSE stream body. */
export function encodeSseStream(events: Iterable<StreamEvent>): string {
  let out = "";
  for (const ev of events) out += encodeSseFrame(ev);
  return out;
}

/** Parse an SSE stream body into events (data parsed as JSON, blank padding skipped). */
export function parseSseFrames(body: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const block of body.split("\n\n")) {
    if (block.trim() === "") continue;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    }
    const data = JSON.parse(dataLines.join("\n"));
    events.push(event !== undefined ? { event, data } : { data });
  }
  return events;
}

/** Server-side application logic for a streamed message: produce the event sequence. */
export interface A2AStreamHandler {
  onMessageStream(message: Message): Promise<StreamEvent[]> | StreamEvent[];
}

/** Register the `message/stream` SSE route on the injected HttpServer. */
export function registerStreamRoute(http: HttpServer, handler: A2AStreamHandler, auth?: AuthProvider): void {
  http.route("POST", A2A_PATHS.rpcStream, async (req) => {
    // Shared JSON-RPC envelope + message validation (identical to message/send).
    const v = validateRpcMessage(req.body, A2A_METHOD_MESSAGE_STREAM);
    if (v.error) {
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: v.id, error: v.error }) };
    }
    if (auth && !authorize(req.headers, auth).ok) {
      return {
        status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", id: v.id, error: { code: JSON_RPC_ERRORS.unauthorized, message: "missing or invalid bearer token" } }),
      };
    }
    const events = await handler.onMessageStream(v.message!);
    return {
      status: 200,
      body: encodeSseStream(events),
      headers: { "content-type": SSE_CONTENT_TYPE, "cache-control": "no-cache" },
    };
  });
}

/** Client-side: send a message via `message/stream` and parse the SSE event sequence. */
export async function streamMessage(http: HttpClient, baseUrl: string, message: Message, token?: string): Promise<StreamEvent[]> {
  const res = await http.request(baseUrl + A2A_PATHS.rpcStream, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: A2A_METHOD_MESSAGE_STREAM, params: { message } }),
    headers: token !== undefined ? bearerHeader(token) : undefined,
  });
  throwIfRateLimited(res); // surface HTTP 429 so the FleetScheduler backs off
  return parseSseFrames(res.body);
}
