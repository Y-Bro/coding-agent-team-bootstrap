import type { Runtime, SpawnCtx } from "./runtime.ts";
import type { TmuxCommands } from "../ports/tmux.ts";
import type { AgentCard } from "../a2a/index.ts";
import type { EngineRegistry } from "../engines/index.ts";

/** v1 runtime: each agent is a tmux pane; wake = send-keys nudge. */
export class PanesRuntime implements Runtime {
  constructor(
    private tmux: TmuxCommands,
    private session: string,
    private engines: EngineRegistry,
  ) {}

  async spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void> {
    const target = `${this.session}:${agent.id}`;
    const p = this.engines.get(agent.engine);
    if (!p) throw new Error(`unknown engine: ${agent.engine}`);
    const profileEnv = Object.entries(p.env ?? {}).map(([k, v]) => `${k}=${v} `).join("");
    const args = p.args?.length ? " " + p.args.join(" ") : "";
    const launch = `TEAM_AGENT_ID=${agent.id} TEAM_SOCKET=${ctx.socketPath} ${profileEnv}${p.command}${args}`;
    this.tmux.run(["new-window", "-t", this.session, "-n", agent.id, "-c", agent.workdir]);
    this.tmux.run(["send-keys", "-t", target, launch, "Enter"]);
  }

  async wake(agentId: string, summary: string): Promise<void> {
    const target = `${this.session}:${agentId}`;
    this.tmux.run(["send-keys", "-t", target,
      `# ▶ mail — ${summary} — run: team inbox`, "Enter"]);
  }

  async teardown(): Promise<void> {
    this.tmux.run(["kill-session", "-t", this.session]);
  }
}
