import type { AgentCard } from "../a2a/index.ts";
import type { TeamConfig } from "../config/index.ts";

/** Context handed to a runtime when it spawns an agent. */
export interface SpawnCtx {
  /** The full validated team config (for runtime-specific options). */
  config: TeamConfig;
  /** Where the broker is listening, so the spawned agent can reach it. */
  socketPath: string;
}

/**
 * The single abstraction over *how* agents are hosted and notified. The broker
 * and bootstrapper depend ONLY on this interface — nothing panes-specific
 * (tmux, send-keys) leaks past it — so a new hosting strategy drops in by
 * implementing `Runtime` and being selected in the composition root.
 *
 * ## Implementing a new runtime (e.g. a real ServersRuntime)
 * - `spawn(agent, ctx)` — bring the agent online so it can talk to the broker
 *   at `ctx.socketPath`. The panes runtime opens a tmux pane and launches the
 *   agent CLI with `TEAM_AGENT_ID`/`TEAM_SOCKET`; a servers runtime would
 *   instead start (or register) an HTTP A2A endpoint per agent. Must be
 *   idempotent enough to tolerate a re-run of `team up`.
 * - `wake(agentId, summary)` — nudge an already-spawned agent that mail is
 *   waiting (the panes runtime sends a one-line `send-keys` hint; a servers
 *   runtime would POST a notification / push to the agent). Must not assume the
 *   agent reads stdin — it only signals "there is new input; pull your inbox".
 * - `teardown()` — release everything `spawn` created (panes runtime kills the
 *   tmux session). Should be safe to call when nothing was spawned.
 *
 * All methods are async so implementations may do I/O (sockets, HTTP, process
 * control) without changing the seam.
 */
export interface Runtime {
  spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void>;
  wake(agentId: string, summary: string): Promise<void>;
  teardown(): Promise<void>;
}
