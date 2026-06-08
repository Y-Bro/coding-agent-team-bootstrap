/**
 * Tiny execution-trace helper (explore/flow-logs branch).
 *
 * Goal: make the codebase narrate itself. Every meaningful seam calls `trace`,
 * so running `team up` / `team new` / `team send` prints an execution-ordered
 * story of the whole flow.
 *
 * Rules:
 * - Writes to STDERR only. stdout carries CLI/protocol output (e.g. `team inbox`
 *   results, socket bytes) and must stay clean — traces must never interleave there.
 * - Gated by the `TEAM_TRACE` env var, DEFAULT ON for this branch. Disable with
 *   `TEAM_TRACE=0` (or `false`/`off`).
 * - Format: `[module] message` — a short tag plus key data, e.g.
 *   `[broker] record msg#7 from=lead to=CA type=task_assignment`.
 *
 * This is intentionally a plain module function, not an injected port: it is a
 * cross-cutting diagnostic for a throwaway learning branch, never merged to main.
 */

function readEnabled(): boolean {
  const v = process.env.TEAM_TRACE;
  if (v === undefined) return true; // default ON for this branch
  return v !== "0" && v.toLowerCase() !== "false" && v.toLowerCase() !== "off";
}

const ENABLED = readEnabled();

/** Emit one narrative trace line to stderr (no-op when disabled). */
export function trace(module: string, message: string): void {
  if (!ENABLED) return;
  process.stderr.write(`[${module}] ${message}\n`);
}

/** True when tracing is on — guard expensive message construction with this. */
export function tracing(): boolean {
  return ENABLED;
}
