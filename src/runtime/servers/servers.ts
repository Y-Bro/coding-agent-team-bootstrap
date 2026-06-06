import type { Runtime, SpawnCtx } from "../runtime.ts";
import type { AgentCard } from "../../a2a/index.ts";
import type { EngineRegistry } from "../../engines/index.ts";
import type { ProcessSpawner, ProcessHandle } from "../../ports/process.ts";

/**
 * The A2A/HTTP surface the servers runtime uses to register a spawned agent
 * (broker-mediated) and to notify it of waiting mail (push). Injected so the
 * runtime tests over a fake HTTP layer.
 */
export interface AgentLink {
  register(card: AgentCard): Promise<void>;
  notify(card: AgentCard, summary: string): Promise<void>;
}

export interface ServersRuntimeDeps {
  spawner: ProcessSpawner;
  engines: EngineRegistry;
  link: AgentLink;
}

/** Validate that an engine is eligible for servers mode (must be kind:"server"). */
export function assertServerEngine(engineName: string, engines: EngineRegistry): void {
  const profile = engines.get(engineName);
  if (!profile) throw new Error(`unknown engine: ${engineName}`);
  if ((profile.kind ?? "repl") !== "server") {
    throw new Error(
      `engine '${engineName}' has kind '${profile.kind ?? "repl"}', but servers mode requires kind:"server"`,
    );
  }
}

/**
 * v2 servers runtime: each agent is a `kind:"server"` engine process hosting its
 * own A2A HTTP surface. `spawn` launches the engine process (via the injected
 * spawner) and registers its Agent Card; `wake` pushes a notification over A2A;
 * `teardown` gracefully stops every spawned process. Behaves entirely through
 * injected ports so it unit-tests with no real sockets or child processes.
 */
export class ServersRuntime implements Runtime {
  private procs = new Map<string, ProcessHandle>();
  private cards = new Map<string, AgentCard>();

  constructor(private deps: ServersRuntimeDeps) {}

  async spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void> {
    assertServerEngine(agent.engine, this.deps.engines);
    const profile = this.deps.engines.get(agent.engine)!;
    const handle = this.deps.spawner.spawn(profile.command, {
      args: profile.args,
      env: { ...(profile.env ?? {}), TEAM_AGENT_ID: agent.id, TEAM_BROKER_SOCKET: ctx.socketPath },
      cwd: agent.workdir,
    });
    this.procs.set(agent.id, handle);
    this.cards.set(agent.id, agent);
    await this.deps.link.register(agent);
  }

  async wake(agentId: string, summary: string): Promise<void> {
    const card = this.cards.get(agentId);
    if (!card) throw new Error(`unknown agent: ${agentId}`);
    await this.deps.link.notify(card, summary);
  }

  async teardown(): Promise<void> {
    for (const handle of this.procs.values()) await handle.kill();
    this.procs.clear();
    this.cards.clear();
  }
}
