import type { TeamConfig } from "../config/index.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { GitCommands } from "../ports/git.ts";
import type { FileSystem } from "../ports/fs.ts";
import { createWorktrees } from "./worktrees.ts";
import { renderRoleFile, roleFileName, toCard } from "./roles.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { AgentCard } from "../a2a/index.ts";
import { dirname, join } from "node:path";

export interface BootstrapDeps {
  runtime: Runtime;
  git: GitCommands;
  fs: FileSystem;
  engines: EngineRegistry;
  templates: Record<string, string>; // role name → template text
  /** Register an agent card with the in-process broker so team ps/send see the roster. */
  register: (card: AgentCard) => void;
  /** Project a card before it is published (e.g. stamp its reachable url). Defaults to identity. */
  stampCard?: (card: AgentCard) => AgentCard;
  /** Directory for broker artifacts (cards). Absolute under run-from-anywhere; defaults to ".team". */
  teamDir?: string;
}

export class Bootstrapper {
  constructor(private cfg: TeamConfig, private deps: BootstrapDeps) {}

  async up(socketPath: string): Promise<void> {
    const teamDir = this.deps.teamDir ?? ".team";
    // git worktree commands must run inside the project repo (base = teamDir's
    // parent), not the cwd `team up` happened to be invoked from.
    createWorktrees(this.cfg, this.deps.git, dirname(teamDir));
    // CAVEAT: two agents sharing a workdir AND the same engine resolve to the
    // same role filename (e.g. CLAUDE.md / AGENTS.md), so the second write
    // clobbers the first. Give such agents distinct workdirs (or worktrees) if
    // they need their own role file; grouping them into one tmux `window` does
    // NOT change this. We detect and warn rather than fail (last write wins).
    // Single source of truth for each agent's published card: stamp once (e.g.
    // its reachable url) so the broker registration, the on-disk
    // .team/cards/<id>.json, and the spawn card are all the identical card.
    const stamp = this.deps.stampCard ?? ((c) => c);
    const cards = this.cfg.agents.map((a) => stamp(toCard(a)));

    const roleFilesSeen = new Set<string>();
    this.cfg.agents.forEach((a, i) => {
      const card = cards[i]!;
      this.deps.register(card); // populate the broker roster (panes engines never self-register)
      this.deps.fs.write(join(teamDir, "cards", `${a.id}.json`), JSON.stringify(card, null, 2));
      const tmplName = a.template ?? a.role;
      const tmpl = this.deps.templates[tmplName] ?? this.deps.templates[a.role] ?? "# {{id}}";
      const roleFilePath = join(card.workdir, roleFileName(a, this.deps.engines));
      if (roleFilesSeen.has(roleFilePath)) {
        console.warn(`warning: role file ${roleFilePath} written by multiple agents — last one (${a.id}) wins`);
      }
      roleFilesSeen.add(roleFilePath);
      // Never-overwrite: `team new`'s ContextScaffolder writes rich per-agent
      // guidance to this same path. Only generate a role file when one is
      // absent (hand-written team.yaml setups), so `team up` never clobbers it.
      if (!this.deps.fs.exists(roleFilePath)) {
        this.deps.fs.write(roleFilePath, renderRoleFile(tmpl, a));
      }
    });
    for (const card of cards) {
      await this.deps.runtime.spawn(card, { config: this.cfg, socketPath, projectRoot: dirname(teamDir) });
    }
  }

  async down(): Promise<void> { await this.deps.runtime.teardown(); }
}
