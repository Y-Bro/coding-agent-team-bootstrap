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
