import { z } from "zod";
import { DEFAULT_MESSAGE_TYPES } from "../a2a/index.ts";

const Worktree = z.object({ branch: z.string(), path: z.string() });

const EngineProfileSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  roleFile: z.string(),
  env: z.record(z.string()).optional(),
  kind: z.enum(["repl", "server"]).default("repl"),
});

const Agent = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  cli: z.enum(["claude", "codex"]).optional(),
  engine: z.string().default("claude"),
  workdir: z.string().default("."),
  worktree: Worktree.optional(),
  template: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  subscribes: z.array(z.string()).default([]),
});

const Broker = z
  .object({
    transport: z.enum(["unix"]).default("unix"),
    socket: z.string().default(".team/broker.sock"),
  })
  .default({ transport: "unix", socket: ".team/broker.sock" });

export const TeamConfigSchema = z.object({
  name: z.string().min(1),
  root: z.string().default("."),
  runtime: z.enum(["panes", "servers"]).default("panes"),
  broker: Broker,
  engines: z.record(EngineProfileSchema).optional(),
  agents: z.array(Agent).min(1),
  windows: z.array(z.string()).default([]),
  messageTypes: z.array(z.string()).default([...DEFAULT_MESSAGE_TYPES]),
}).superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  for (const a of cfg.agents) {
    if (seen.has(a.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate agent id: ${a.id}` });
    }
    seen.add(a.id);
  }
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;
export type AgentConfig = TeamConfig["agents"][number];
