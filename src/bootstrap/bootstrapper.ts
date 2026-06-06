import type { TeamConfig } from "../config/index.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { GitCommands } from "../ports/git.ts";
import type { FileSystem } from "../ports/fs.ts";
import { createWorktrees } from "./worktrees.ts";
import { renderRoleFile, roleFileName, toCard } from "./roles.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { AgentCard } from "../a2a/index.ts";

export interface BootstrapDeps {
  runtime: Runtime;
  git: GitCommands;
  fs: FileSystem;
  engines: EngineRegistry;
  templates: Record<string, string>; // role name → template text
  /** Register an agent card with the in-process broker so team ps/send see the roster. */
  register: (card: AgentCard) => void;
}

export class Bootstrapper {
  constructor(private cfg: TeamConfig, private deps: BootstrapDeps) {}

  async up(socketPath: string): Promise<void> {
    createWorktrees(this.cfg, this.deps.git);
    for (const a of this.cfg.agents) {
      const card = toCard(a);
      this.deps.register(card); // populate the broker roster (panes engines never self-register)
      this.deps.fs.write(`.team/cards/${a.id}.json`, JSON.stringify(card, null, 2));
      const tmplName = a.template ?? a.role;
      const tmpl = this.deps.templates[tmplName] ?? this.deps.templates[a.role] ?? "# {{id}}";
      this.deps.fs.write(`${card.workdir}/${roleFileName(a, this.deps.engines)}`, renderRoleFile(tmpl, a));
    }
    for (const a of this.cfg.agents) {
      await this.deps.runtime.spawn(toCard(a), { config: this.cfg, socketPath });
    }
  }

  async down(): Promise<void> { await this.deps.runtime.teardown(); }
}
