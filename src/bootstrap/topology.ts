import { resolve } from "node:path";
import type { TeamConfig } from "../config/index.ts";

export interface PaneSpec { agentId: string; cli: string; workdir: string; }
export interface TopologyPlan { session: string; agentPanes: PaneSpec[]; extraWindows: string[]; }

/**
 * Plan the tmux topology. When `base` is given, each pane's workdir is resolved
 * against it so tmux receives an absolute `-c` dir (run-from-anywhere). An
 * already-absolute workdir is returned unchanged.
 */
export function planTopology(cfg: TeamConfig, base?: string): TopologyPlan {
  const at = (dir: string) => (base ? resolve(base, dir) : dir);
  return {
    session: cfg.name,
    agentPanes: cfg.agents.map((a) => ({
      agentId: a.id,
      cli: a.cli,
      workdir: at(a.worktree?.path ?? a.workdir),
    })),
    extraWindows: cfg.windows,
  };
}
