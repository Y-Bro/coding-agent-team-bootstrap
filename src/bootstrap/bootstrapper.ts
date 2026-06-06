import type { TeamConfig } from "../config/index.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { GitCommands } from "../ports/git.ts";
import type { FileSystem } from "../ports/fs.ts";
import { createWorktrees } from "./worktrees.ts";
import { renderRoleFile, roleFileName, toCard } from "./roles.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { AgentCard } from "../a2a/index.ts";
import { join } from "node:path";

export interface BootstrapDeps {
  runtime: Runtime;
  git: GitCommands;
  fs: FileSystem;
  engines: EngineRegistry;
  templates: Record<string, string>; // role name → template text
  /** Register an agent card with the in-process broker so team ps/send see the roster. */
  register: (card: AgentCard) => void;
  /** Directory for broker artifacts (cards). Absolute under run-from-anywhere; defaults to ".team". */
  teamDir?: string;
}

export class Bootstrapper {
  constructor(private cfg: TeamConfig, private deps: BootstrapDeps) {}

  async up(socketPath: string): Promise<void> {
    createWorktrees(this.cfg, this.deps.git);
    const teamDir = this.deps.teamDir ?? ".team";
    // CAVEAT: two agents sharing a workdir AND the same engine resolve to the
    // same role filename (e.g. CLAUDE.md / AGENTS.md), so the second write
    // clobbers the first. Give such agents distinct workdirs (or worktrees) if
    // they need their own role file; grouping them into one tmux `window` does
    // NOT change this. We detect and warn rather than fail (last write wins).
    const roleFilesSeen = new Set<string>();
    for (const a of this.cfg.agents) {
      const card = toCard(a);
      this.deps.register(card); // populate the broker roster (panes engines never self-register)
      this.deps.fs.write(join(teamDir, "cards", `${a.id}.json`), JSON.stringify(card, null, 2));
      const tmplName = a.template ?? a.role;
      const tmpl = this.deps.templates[tmplName] ?? this.deps.templates[a.role] ?? "# {{id}}";
      const roleFilePath = join(card.workdir, roleFileName(a, this.deps.engines));
      if (roleFilesSeen.has(roleFilePath)) {
        console.warn(`warning: role file ${roleFilePath} written by multiple agents — last one (${a.id}) wins`);
      }
      roleFilesSeen.add(roleFilePath);
      this.deps.fs.write(roleFilePath, renderRoleFile(tmpl, a));
    }
    for (const a of this.cfg.agents) {
      await this.deps.runtime.spawn(toCard(a), { config: this.cfg, socketPath });
    }
  }

  async down(): Promise<void> { await this.deps.runtime.teardown(); }
}
