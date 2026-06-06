export type Cli = "claude" | "codex";

export interface AgentCard {
  id: string;
  role: string;
  cli: Cli;
  engine: string;
  capabilities: string[];
  skills: string[];
  workdir: string;
  subscribes: string[];
  /** Reachable A2A base URL this agent advertises (multi-host, v3-m3). Resolved from config. */
  url?: string;
}

export type Part =
  | { kind: "text"; text: string }
  | { kind: "data"; data: unknown }
  | { kind: "file"; path: string };

export interface Message {
  id: string;
  task?: string;
  from: string;
  to: string;
  type: string;
  parts: Part[];
  ts: string;
}

export type TaskState =
  | "submitted" | "working" | "input-required"
  | "completed" | "failed" | "canceled";

export interface Task {
  id: string;
  title: string;
  state: TaskState;
  owner: string;
  history: Message[];
  artifacts: Part[];
}

export const DEFAULT_MESSAGE_TYPES = [
  "review_request", "review_comment", "approval", "escalation",
  "ruling", "status", "task_assignment", "note",
] as const;

export function isPart(p: unknown): p is Part {
  if (typeof p !== "object" || p === null) return false;
  const x = p as Record<string, unknown>;
  switch (x.kind) {
    case "text": return typeof x.text === "string";
    case "data": return "data" in x;
    case "file": return typeof x.path === "string";
    default: return false;
  }
}

export function isMessage(m: unknown): m is Message {
  if (typeof m !== "object" || m === null) return false;
  const x = m as Record<string, unknown>;
  return (
    typeof x.id === "string" && typeof x.from === "string" &&
    typeof x.to === "string" && typeof x.type === "string" &&
    typeof x.ts === "string" &&
    Array.isArray(x.parts) && x.parts.every(isPart)
  );
}
