import type { AgentCard } from "../a2a/index.ts";
import type { TeamConfig } from "../config/index.ts";

export interface SpawnCtx {
  config: TeamConfig;
  socketPath: string;
}

export interface Runtime {
  spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void>;
  wake(agentId: string, summary: string): Promise<void>;
  teardown(): Promise<void>;
}
