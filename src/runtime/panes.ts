import type { Runtime, SpawnCtx } from "./runtime.ts";
import type { TmuxCommands } from "../ports/tmux.ts";
import type { AgentCard } from "../a2a/index.ts";
import type { EngineRegistry } from "../engines/index.ts";

/** v1 runtime: each agent is a tmux pane; wake = send-keys nudge. */
export class PanesRuntime implements Runtime {
  /** Whether the tmux session exists yet (the first agent creates it). */
  private sessionCreated = false;
  /** agentId → stable tmux window id (`#{window_id}`), captured at spawn. */
  private windowIds = new Map<string, string>();

  constructor(
    private tmux: TmuxCommands,
    private session: string,
    private engines: EngineRegistry,
  ) {}

  async spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void> {
    const p = this.engines.get(agent.engine);
    if (!p) throw new Error(`unknown engine: ${agent.engine}`);
    const profileEnv = Object.entries(p.env ?? {}).map(([k, v]) => `${k}=${v} `).join("");
    const args = p.args?.length ? " " + p.args.join(" ") : "";
    const launch = `TEAM_AGENT_ID=${agent.id} TEAM_SOCKET=${ctx.socketPath} ${profileEnv}${p.command}${args}`;
    const windowId = this.openWindow(agent.id, agent.workdir);
    this.windowIds.set(agent.id, windowId);
    this.tmux.run(["send-keys", "-t", windowId, launch, "Enter"]);
  }

  async wake(agentId: string, summary: string): Promise<void> {
    // Target the stable window id — tmux automatic-rename breaks session:name.
    const target = this.windowIds.get(agentId) ?? `${this.session}:${agentId}`;
    this.tmux.run(["send-keys", "-t", target,
      `# ▶ mail — ${summary} — run: team inbox`, "Enter"]);
  }

  async teardown(): Promise<void> {
    this.tmux.run(["kill-session", "-t", this.session]);
  }

  /**
   * Open a window for an agent and return its stable id. The first agent creates
   * the session (`new-session`); later agents add windows (`new-window`). Both
   * print the new window id via `-P -F '#{window_id}'`.
   */
  private openWindow(id: string, workdir: string): string {
    const capture = ["-P", "-F", "#{window_id}"];
    const out = this.sessionCreated
      ? this.tmux.run(["new-window", "-t", this.session, "-n", id, "-c", workdir, ...capture])
      : this.tmux.run(["new-session", "-d", "-s", this.session, "-n", id, "-c", workdir, ...capture]);
    this.sessionCreated = true;
    return out.trim();
  }
}
