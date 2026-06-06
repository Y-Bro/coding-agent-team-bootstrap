import type { TeamConfig } from "../config/index.ts";
import type { Runtime } from "./runtime.ts";
import type { TmuxCommands } from "../ports/tmux.ts";
import { PanesRuntime } from "./panes.ts";
import { ServersRuntime } from "./servers.ts";

/**
 * Config-driven runtime selection. `runtime: panes` hosts each agent in a tmux
 * pane (needs the tmux port); `runtime: servers` returns the v1 stub. Adding a
 * future runtime means a new `case`, with the rest of the system unchanged
 * because everything depends on the `Runtime` seam.
 */
export function selectRuntime(cfg: TeamConfig, tmux: TmuxCommands): Runtime {
  switch (cfg.runtime) {
    case "servers": return new ServersRuntime();
    case "panes": return new PanesRuntime(tmux, cfg.name);
  }
}
