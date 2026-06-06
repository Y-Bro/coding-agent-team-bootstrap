import type { TeamConfig } from "../config/index.ts";
import type { GitCommands } from "../ports/git.ts";

export function createWorktrees(cfg: TeamConfig, git: GitCommands): void {
  for (const a of cfg.agents) {
    if (!a.worktree) continue;
    git.run(["worktree", "add", "-b", a.worktree.branch, a.worktree.path]);
  }
}
