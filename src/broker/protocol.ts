import type { Part, Message } from "../a2a/index.ts";

export type Request =
  | { method: "agent/register"; params: { card: import("../a2a/index.ts").AgentCard } }
  | { method: "agent/list"; params: {} }
  | { method: "message/send"; params: { from: string; to: string; type: string; parts: Part[]; task?: string } }
  | { method: "message/observe"; params: { message: Message } }
  | { method: "inbox/read"; params: { agentId: string } };

export type Response =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export function encode(value: unknown): string { return JSON.stringify(value) + "\n"; }
export function* decodeLines(buffer: string): Generator<unknown> {
  for (const line of buffer.split("\n")) {
    if (line.trim() !== "") yield JSON.parse(line);
  }
}
