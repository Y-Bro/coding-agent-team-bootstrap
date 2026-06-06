/**
 * An "engine" is the CLI coding agent a team member runs (Claude Code, Codex,
 * Cursor Agent, opencode, Gemini, aider, …). An {@link EngineProfile} is the
 * pure, static description of one engine: the command that launches it, its
 * interaction model, and the role-instruction file it reads. Profiles carry no
 * behavior and no I/O — detection/launch happen behind injected ports, and the
 * registry maps an engine command to its profile.
 */

/**
 * Interaction model of an engine. v1 engines are all interactive REPLs the
 * panes runtime drives via `send-keys`; the union leaves room for future
 * models (e.g. one-shot or server-hosted) without touching the seam.
 */
export type EngineKind = "repl";

export interface EngineProfile {
  /** Command/binary that launches the engine; also its identity and PATH probe. */
  command: string;
  /** Interaction model (how the runtime drives it). */
  kind: EngineKind;
  /** Role-instruction filename this engine reads in its workdir (e.g. CLAUDE.md). */
  roleFile: string;
}
