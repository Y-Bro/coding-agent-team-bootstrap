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
 *
 * When NO agent declares a worktree we touch git at all — a panes team with
 * plain workdirs needs no repo, so `team up` works in any (even non-git) base
 * dir. Only the worktree path runs `git worktree`, and there a missing repo
 * fails with a clear message instead of a raw git stack trace.
 */
export function createWorktrees(cfg: TeamConfig, git: GitCommands, cwd?: string): void {
  const declaring = cfg.agents.filter((a) => a.worktree);
  if (declaring.length === 0) return; // no worktrees → no git required

  let existing: string[];
  try {
    existing = existingWorktreePaths(git, cwd);
  } catch {
    throw new Error(`worktrees require a git repo at ${cwd ?? process.cwd()}`);
  }

  const created = new Set<string>();
  for (const a of declaring) {
    const { branch, path } = a.worktree!;
    if (created.has(path) || alreadyPresent(existing, path)) continue;
    git.run(["worktree", "add", "-b", branch, path], cwd);
    created.add(path);
  }
}
