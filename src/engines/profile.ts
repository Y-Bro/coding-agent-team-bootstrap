/**
 * An "engine" is the CLI coding agent a team member runs (Claude Code, Codex,
 * …). An {@link EngineProfile} is the pure, static description of one engine:
 * how to launch it, how to detect it on PATH, and which role-instruction file
 * it reads. Profiles carry no behavior and no I/O — detection/launch happen
 * behind injected ports (which/tmux), and the registry (next task) maps an
 * {@link EngineKind} to its profile.
 */

/** Stable identifier for a built-in engine; matches AgentConfig/AgentCard `cli`. */
export type EngineKind = "claude" | "codex";

/** The built-in engine identifiers, in canonical order. */
export const ENGINE_KINDS = ["claude", "codex"] as const;

export interface EngineProfile {
  /** Stable identifier (matches `AgentCard.cli`). */
  kind: EngineKind;
  /** Human-friendly name for prompts and doctor output. */
  displayName: string;
  /** Executable launched in the agent's pane/host. */
  command: string;
  /** Executable name probed with `which` to check availability. */
  bin: string;
  /** Role-instruction filename this engine reads in its workdir (e.g. CLAUDE.md). */
  roleFile: string;
}

/** Runtime guard: is `value` one of the known built-in engine kinds? */
export function isEngineKind(value: unknown): value is EngineKind {
  return typeof value === "string" && (ENGINE_KINDS as readonly string[]).includes(value);
}
