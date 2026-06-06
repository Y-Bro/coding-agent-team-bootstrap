import type { TeamConfig } from "../config/index.ts";
import type { GitCommands } from "../ports/git.ts";

/** Paths git already tracks as worktrees, parsed from `worktree list --porcelain`. */
function existingWorktreePaths(git: GitCommands, cwd?: string): string[] {
  return git.run(["worktree", "list", "--porcelain"], cwd)
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length).trim());
}

function alreadyPresent(existing: string[], path: string): boolean {
  const norm = path.replace(/\/+$/, "");
  return existing.some((e) => {
    const en = e.replace(/\/+$/, "");
    return en === norm || en.endsWith(`/${norm}`);
  });
}

/**
 * Create a branch+worktree for each agent that declares one. Idempotent:
 * a path already registered as a worktree is reused, and a path declared by
 * multiple agents (a shared worktree) is created once.
 */
export function createWorktrees(cfg: TeamConfig, git: GitCommands, cwd?: string): void {
  const existing = existingWorktreePaths(git, cwd);
  const created = new Set<string>();
  for (const a of cfg.agents) {
    if (!a.worktree) continue;
    const { branch, path } = a.worktree;
    if (created.has(path) || alreadyPresent(existing, path)) continue;
    git.run(["worktree", "add", "-b", branch, path], cwd);
    created.add(path);
  }
}
