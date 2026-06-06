import type { TeamConfig } from "../config/index.ts";

export interface PaneSpec { agentId: string; cli: string; workdir: string; }
export interface TopologyPlan { session: string; agentPanes: PaneSpec[]; extraWindows: string[]; }

export function planTopology(cfg: TeamConfig): TopologyPlan {
  return {
    session: cfg.name,
    agentPanes: cfg.agents.map((a) => ({
      agentId: a.id,
      cli: a.cli,
      workdir: a.worktree?.path ?? a.workdir,
    })),
    extraWindows: cfg.windows,
  };
}
