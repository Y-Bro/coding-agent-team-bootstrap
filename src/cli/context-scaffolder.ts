import { resolve } from "node:path";
import type { FileSystem } from "../ports/fs.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { GuidanceGenerator } from "../ports/guidance.ts";

/** Hard cap on every generated context file (guidance + blank + footer). */
const MAX_MD_LINES = 200;

export interface ScaffoldAgent {
  id: string;
  role: string;
  engine: string;
  subscribes?: string[];
  workdir?: string;
  worktree?: { branch: string; path: string };
}

/** One-line meaning per message type (the protocol vocabulary). */
const MESSAGE_TYPE_HELP: ReadonlyArray<readonly [string, string]> = [
  ["task_assignment", "assign a unit of work to a teammate"],
  ["status", "progress update on current work"],
  ["review_request", "ask a teammate to review your work"],
  ["review_comment", "feedback on something under review"],
  ["approval", "sign off that work is acceptable"],
  ["ruling", "a decision that resolves a question or dispute"],
  ["escalation", "raise a blocker or issue to the orchestrator"],
  ["note", "general FYI that needs no action"],
];

/**
 * Deterministic "How to communicate" block, derived purely from config: identity,
 * teammates, subscriptions, the hub-and-spoke topology (orchestrator = `all[0]`),
 * the broker commands, the message-type vocabulary, and two role-fit examples.
 * Compact by design (~35 lines) — stays well within the 200-line context cap.
 */
export function buildWiringFooter(team: string, self: ScaffoldAgent, all: ScaffoldAgent[]): string {
  const teammates = all.filter((a) => a.id !== self.id)
    .map((a) => `${a.id} (${a.role})`).join(", ") || "(none)";
  const subs = (self.subscribes ?? []).join(", ") || "(none)";
  const orchestrator = all[0]?.id ?? self.id;
  const isHub = self.id === orchestrator;
  const someTeammate = all.find((a) => a.id !== self.id)?.id ?? "<teammate>";

  const topology = isHub
    ? `- You ARE the orchestrator: you hear every message type and may address any teammate directly by id.`
    : `- Send your messages to the orchestrator **${orchestrator}**; team-wide traffic flows through the orchestrator.`;

  const examples = isHub
    ? [
        `- Assign work:   \`team send --to ${someTeammate} --type task_assignment --text "..."\``,
        `- Make a ruling: \`team send --to ${someTeammate} --type ruling --text "..."\``,
      ]
    : [
        `- Report status:   \`team send --to ${orchestrator} --type status --text "..."\``,
        `- Raise a blocker: \`team send --to ${orchestrator} --type escalation --text "..."\``,
      ];

  return [
    `## How to communicate`,
    ``,
    `- You are **${self.id}** (role: ${self.role}) on team **${team}**.`,
    `- Teammates: ${teammates}.`,
    `- You receive messages of type: ${subs}.`,
    ``,
    `Topology — hub-and-spoke through **${orchestrator}** (the orchestrator):`,
    topology,
    ``,
    `Commands:`,
    `- Read pending mail:  \`team inbox ${self.id}\``,
    `- Send a message:     \`team send --to <id> --type <type> --text "..."\`  (reference the relevant task when replying)`,
    ``,
    `Message types:`,
    ...MESSAGE_TYPE_HELP.map(([t, meaning]) => `- ${t} — ${meaning}`),
    ``,
    `Examples:`,
    ...examples,
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
        // Trim the guidance so guidance + blank separator + footer stays within
        // the 200-line cap; the wiring footer is always preserved intact.
        const footerLines = footer.split("\n").length;
        const budget = Math.max(0, MAX_MD_LINES - footerLines - 1); // -1 for the blank separator
        const trimmed = text.split("\n").slice(0, budget).join("\n");
        this.fs.write(target, `${trimmed}\n\n${footer}`);
      }
    }
  }
}
