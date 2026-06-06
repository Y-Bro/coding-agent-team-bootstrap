/**
 * An "engine" is the CLI coding agent a team member runs (Claude Code, Codex,
 * Cursor Agent, opencode, Gemini, aider, …). An {@link EngineProfile} is the
 * pure, static description of one engine: its name (identity), the command that
 * launches it (plus optional args/env), its interaction model, and the
 * role-instruction file it reads. Profiles carry no behavior and no I/O — the
 * registry maps an engine name to its profile and ports do the launching.
 */

/**
 * Interaction model of an engine. v1 engines are interactive REPLs the panes
 * runtime drives via `send-keys`; `server` is reserved for the servers runtime.
 */
export type EngineKind = "repl" | "server";

export interface EngineProfile {
  /** Identity: what `AgentConfig.engine` references and the registry keys on. */
  name: string;
  /** Command/binary that launches the engine; also its PATH probe. */
  command: string;
  /** Role-instruction filename this engine reads in its workdir (e.g. CLAUDE.md). */
  roleFile: string;
  /** Interaction model (defaults to "repl" when omitted in config). */
  kind?: EngineKind;
  /** Extra launch arguments. */
  args?: string[];
  /** Extra environment variables for the engine process. */
  env?: Record<string, string>;
}
