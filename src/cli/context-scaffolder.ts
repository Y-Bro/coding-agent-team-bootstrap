import { resolve } from "node:path";
import type { FileSystem } from "../ports/fs.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { GuidanceGenerator } from "../ports/guidance.ts";

export interface ScaffoldAgent {
  id: string;
  role: string;
  engine: string;
  subscribes?: string[];
  workdir?: string;
  worktree?: { branch: string; path: string };
}

/** Deterministic team-wiring block, derived purely from config. */
export function buildWiringFooter(team: string, self: ScaffoldAgent, all: ScaffoldAgent[]): string {
  const teammates = all.filter((a) => a.id !== self.id)
    .map((a) => `${a.id} (${a.role})`).join(", ") || "(none)";
  const subs = (self.subscribes ?? []).join(", ") || "(none)";
  const anyTeammate = all.find((a) => a.id !== self.id)?.id ?? "lead";
  return [
    `## Team wiring`,
    ``,
    `- You are **${self.id}** (role: ${self.role}) on team **${team}**.`,
    `- Teammates: ${teammates}.`,
    `- You receive messages of type: ${subs}.`,
    ``,
    `Read your mail:  \`team inbox ${self.id}\``,
    `Reply / send:    \`team send --to ${anyTeammate} --type status --text "..."\``,
    ``,
  ].join("\n");
}

/**
 * Writes one context file per agent, named by its engine's `roleFile`, into its
 * workdir/worktree path (joined under `base`). File = `guidance + "\n\n" + footer`
 * when the generator returns text; `footer` only (plus a warning) when it returns
 * null. Never overwrites an existing file (skip + warn). All side effects go
 * through the injected FileSystem, GuidanceGenerator, and EngineRegistry.
 */
export class ContextScaffolder {
  constructor(
    private fs: FileSystem,
    private guidance: GuidanceGenerator,
    private engines: EngineRegistry,
    private warn: (msg: string) => void = () => {},
  ) {}

  async scaffold(team: string, agents: ScaffoldAgent[], base: string): Promise<void> {
    for (const a of agents) {
      const profile = this.engines.get(a.engine);
      const roleFile = profile?.roleFile ?? "CONTEXT.md";
      const dir = a.worktree?.path ?? a.workdir ?? ".";
      // resolve (not join) so an already-absolute workdir/worktree path is NOT
      // re-prefixed with base — matching resolveConfigPaths semantics.
      const target = resolve(base, dir, roleFile);

      if (this.fs.exists(target)) {
        this.warn(`context file exists, skipping: ${target}`);
        continue;
      }
      const footer = buildWiringFooter(team, a, agents);
      const text = await this.guidance.generate({ role: a.role, id: a.id, team, engine: a.engine });
      if (text === null) {
        this.warn(`guidance unavailable for ${a.id}; wrote wiring-only ${target}`);
        this.fs.write(target, footer);
      } else {
        this.fs.write(target, `${text}\n\n${footer}`);
      }
    }
  }
}
