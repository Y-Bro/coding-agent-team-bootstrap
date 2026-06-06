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

const Agent = z
  .object({
    id: z.string().min(1),
    role: z.string().min(1),
    cli: z.enum(["claude", "codex"]).default("claude"),
    engine: z.string().optional(),
    workdir: z.string().default("."),
    worktree: Worktree.optional(),
    template: z.string().optional(),
    // panes mode: agents sharing a `window` value become panes in ONE tmux
    // window; omitted defaults (at runtime) to the agent id (one window each).
    window: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
    skills: z.array(z.string()).default([]),
    subscribes: z.array(z.string()).default([]),
    // servers mode: optional explicit A2A port (else derived from servers.basePort + index).
    port: z.number().int().positive().optional(),
  })
  .transform((a) => ({
    ...a,
    // engine defaults from cli when omitted; explicit engine always wins.
    engine: a.engine ?? a.cli ?? "claude",
  }));

const Broker = z
  .object({
    transport: z.enum(["unix"]).default("unix"),
    socket: z.string().default(".team/broker.sock"),
  })
  .default({ transport: "unix", socket: ".team/broker.sock" });

/** Fleet rate-limit knobs (LEAD DECISION Q4) — feeds the FleetScheduler in servers mode. */
const RateLimit = z
  .object({
    maxConcurrency: z.number().int().positive().default(4),
    bucketCapacity: z.number().positive().default(8),
    refillPerSec: z.number().positive().default(2),
  })
  .default({});

/**
 * servers-mode settings (v2): A2A endpoint host + base port (per-agent ports
 * derive from basePort + index unless an agent overrides), broker-issued bearer
 * auth toggle, and the shared fleet rate-limit knobs. Defaults are safe for
 * loopback so a `runtime: servers` team needs no extra config.
 */
const Servers = z
  .object({
    host: z.string().default("127.0.0.1"),
    basePort: z.number().int().positive().default(41000),
    auth: z.boolean().default(true),
    rateLimit: RateLimit,
  })
  .default({});

export const TeamConfigSchema = z.object({
  name: z.string().min(1),
  root: z.string().default("."),
  runtime: z.enum(["panes", "servers"]).default("panes"),
  // v3 (servers mode): "broker" = broker-mediated delivery (default, unchanged);
  // "direct" = peer-to-peer A2A delivery with the broker as registry+observer.
  delivery: z.enum(["broker", "direct"]).default("broker"),
  broker: Broker,
  servers: Servers,
  engines: z.record(EngineProfileSchema).optional(),
  agents: z.array(Agent).min(1),
  windows: z.array(z.string()).default([]),
  // panes mode: tmux layout to apply to each shared window (keyed by window
  // name). Windows not listed fall back to `even-horizontal` at runtime.
  layout: z.record(z.enum(["even-horizontal", "even-vertical", "tiled", "main-vertical"])).default({}),
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
