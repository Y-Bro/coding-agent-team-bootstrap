import type { Runtime, SpawnCtx } from "./runtime.ts";
import type { AgentCard } from "../a2a/index.ts";

export type RuntimeKind = "panes" | "servers";

/**
 * v3 mixed-runtime host: routes each agent to the runtime it was assigned
 * (`agent.runtime`, else the team default), so one team can run some agents in
 * tmux panes and others as A2A servers. `spawn` delegates by the resolved kind
 * and remembers it; `wake` targets the same runtime; `teardown` tears down each
 * distinct runtime once. Behaves through the {@link Runtime} seam, so the broker
 * and bootstrapper are unaware a team is mixed.
 */
export class CompositeRuntime implements Runtime {
  private kinds = new Map<string, RuntimeKind>();

  constructor(
    private runtimes: Record<RuntimeKind, Runtime>,
    private resolve: (agent: AgentCard) => RuntimeKind,
  ) {}

  async spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void> {
    const kind = this.resolve(agent);
    this.kinds.set(agent.id, kind);
    await this.runtimes[kind].spawn(agent, ctx);
  }

  async wake(agentId: string, summary: string): Promise<void> {
    const kind = this.kinds.get(agentId);
    if (!kind) throw new Error(`unknown agent: ${agentId}`);
    await this.runtimes[kind].wake(agentId, summary);
  }

  async teardown(): Promise<void> {
    for (const r of new Set(Object.values(this.runtimes))) await r.teardown();
  }
}
