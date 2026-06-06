import type { Runtime, SpawnCtx } from "./runtime.ts";
import type { AgentCard } from "../a2a/index.ts";

const NOT_IMPLEMENTED =
  "ServersRuntime not implemented in v1 — set `runtime: panes` in team.yaml, " +
  "or implement the HTTP A2A runtime against the Runtime seam (see runtime.ts).";

/**
 * v1 seam only: proves the `Runtime` abstraction so a real HTTP A2A runtime can
 * drop in later without touching the broker or bootstrapper. The operations
 * that require live hosting (`spawn`, `wake`) throw a clear, actionable
 * not-implemented error; `teardown` is a safe no-op because nothing was ever
 * spawned, so `team down` over a servers config stays clean.
 */
export class ServersRuntime implements Runtime {
  async spawn(_agent: AgentCard, _ctx: SpawnCtx): Promise<void> { throw new Error(NOT_IMPLEMENTED); }
  async wake(_agentId: string, _summary: string): Promise<void> { throw new Error(NOT_IMPLEMENTED); }
  async teardown(): Promise<void> { /* nothing spawned → nothing to release */ }
}
