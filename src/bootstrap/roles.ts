import type { AgentConfig } from "../config/index.ts";
import type { AgentCard } from "../a2a/index.ts";
import type { EngineRegistry } from "../engines/index.ts";

/** Filename the agent's engine auto-reads for its role/instructions (e.g. CLAUDE.md). */
export function roleFileName(
  agent: { engine: string },
  engines: EngineRegistry,
): string {
  const profile = engines.get(agent.engine);
  if (!profile) throw new Error(`unknown engine: ${agent.engine}`);
  return profile.roleFile;
}

export function toCard(a: AgentConfig): AgentCard {
  return {
    id: a.id, role: a.role, cli: a.cli, engine: a.engine,
    capabilities: a.capabilities, skills: a.skills,
    workdir: a.worktree?.path ?? a.workdir, subscribes: a.subscribes,
  };
}

/** Minimal mustache-style substitution: {{id}}, {{role}}, {{capabilities}}, {{workdir}}. */
export function renderRoleFile(template: string, a: AgentConfig): string {
  const card = toCard(a);
  const vars: Record<string, string> = {
    id: card.id, role: card.role, cli: card.cli,
    workdir: card.workdir, capabilities: card.capabilities.join(", "),
    subscribes: card.subscribes.join(", "),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}
