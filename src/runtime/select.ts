import type { TeamConfig, AgentConfig } from "../config/index.ts";
import type { Runtime } from "./runtime.ts";
import type { TmuxCommands } from "../ports/tmux.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { Sleeper } from "../ports/sleeper.ts";
import { trace } from "../obs/trace.ts";
import { PanesRuntime } from "./panes.ts";
import { CompositeRuntime, type RuntimeKind } from "./composite.ts";
import { assertServerEngine } from "./servers/servers.ts";

/** The runtime an agent runs on: its own `runtime`, else the team default. */
export function effectiveRuntime(agent: Pick<AgentConfig, "runtime">, cfg: Pick<TeamConfig, "runtime">): RuntimeKind {
  return agent.runtime ?? cfg.runtime;
}

/**
 * Config-driven runtime selection. Each agent runs on its `runtime` (else the
 * team default). A single-kind team builds that one runtime (panes = tmux panes;
 * servers = A2A server processes, every server agent's engine validated as
 * `kind:"server"`). A MIXED team builds a {@link CompositeRuntime} that routes
 * each agent to its kind. The servers runtime is built via the injected factory
 * (the composition root supplies its ports); the rest of the system depends only
 * on the `Runtime` seam.
 */
export function selectRuntime(
  cfg: TeamConfig,
  tmux: TmuxCommands,
  engines: EngineRegistry,
  makeServersRuntime: () => Runtime,
  sleeper: Sleeper,
): Runtime {
  const kinds = new Set(cfg.agents.map((a) => effectiveRuntime(a, cfg)));
  const needsPanes = kinds.has("panes");
  const needsServers = kinds.has("servers");

  // Validate server-eligibility only for agents actually hosted on servers.
  if (needsServers) {
    for (const a of cfg.agents) {
      if (effectiveRuntime(a, cfg) === "servers") assertServerEngine(a.engine, engines);
    }
  }

  if (needsServers && !needsPanes) { trace("select", "runtime=servers (all agents on A2A servers)"); return makeServersRuntime(); }
  if (needsPanes && !needsServers) { trace("select", `runtime=panes (tmux session '${cfg.name}')`); return new PanesRuntime(tmux, cfg.name, engines, sleeper); }

  // mixed: route per agent by its effective runtime (resolved by id from config).
  trace("select", "runtime=composite (mixed panes+servers, routed per agent)");
  const kindById = new Map(cfg.agents.map((a) => [a.id, effectiveRuntime(a, cfg)] as const));
  return new CompositeRuntime(
    { panes: new PanesRuntime(tmux, cfg.name, engines, sleeper), servers: makeServersRuntime() },
    (agent) => kindById.get(agent.id) ?? cfg.runtime,
  );
}
