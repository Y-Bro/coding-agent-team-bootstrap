import { dirname, resolve } from "node:path";
import type { TeamConfig } from "./schema.ts";

/**
 * The base directory every relative path in the config resolves against.
 *
 * Precedence (per the run-from-anywhere contract): an explicit `root` wins, then
 * the directory of the config file (TEAM_CONFIG), then the cwd. This falls out
 * of one `resolve()`: a relative `root` (default ".") is interpreted against the
 * config file's directory, an absolute `root` overrides it, and a bare config
 * path (no directory) resolves its "." against the cwd.
 */
export function resolveBase(cfg: Pick<TeamConfig, "root">, configPath: string): string {
  return resolve(dirname(configPath), cfg.root);
}

/**
 * Return a copy of the config with every filesystem path made absolute against
 * `base`: the broker socket and each agent's workdir / worktree path. Lets the
 * team be brought up from any cwd — tmux gets absolute `-c` dirs and the broker
 * artifacts land under the project's `base/.team` regardless of where `team` runs.
 */
export function resolveConfigPaths(cfg: TeamConfig, base: string): TeamConfig {
  return {
    ...cfg,
    broker: { ...cfg.broker, socket: resolve(base, cfg.broker.socket) },
    agents: cfg.agents.map((a) => ({
      ...a,
      workdir: resolve(base, a.workdir),
      worktree: a.worktree ? { ...a.worktree, path: resolve(base, a.worktree.path) } : a.worktree,
    })),
  };
}
