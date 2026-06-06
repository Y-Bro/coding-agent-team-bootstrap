import type { TeamConfig } from "../config/index.ts";
import type { Runtime } from "./runtime.ts";
import type { TmuxCommands } from "../ports/tmux.ts";
import type { EngineRegistry } from "../engines/index.ts";
import { PanesRuntime } from "./panes.ts";
import { assertServerEngine } from "./servers/servers.ts";

/**
 * Config-driven runtime selection. `runtime: panes` hosts each agent in a tmux
 * pane; `runtime: servers` requires every agent's engine to be `kind:"server"`
 * (validated here with a clear error) and builds the servers runtime via the
 * injected factory (the composition root supplies its ports). Adding a runtime
 * means a new `case`; the rest of the system depends only on the `Runtime` seam.
 */
export function selectRuntime(
  cfg: TeamConfig,
  tmux: TmuxCommands,
  engines: EngineRegistry,
  makeServersRuntime: () => Runtime,
): Runtime {
  switch (cfg.runtime) {
    case "servers":
      for (const agent of cfg.agents) assertServerEngine(agent.engine, engines);
      return makeServersRuntime();
    case "panes":
      return new PanesRuntime(tmux, cfg.name, engines);
  }
}
