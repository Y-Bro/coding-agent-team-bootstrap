import type { Runtime, SpawnCtx } from "./runtime.ts";
import type { TmuxCommands } from "../ports/tmux.ts";
import type { AgentCard } from "../a2a/index.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { Sleeper } from "../ports/sleeper.ts";

const DEFAULT_LAYOUT = "even-horizontal";
/**
 * Pause between typing a pane's text and pressing Enter. Some engines (codex,
 * cursor-agent) drop an Enter that arrives in the same send-keys call as the
 * text (render race), so we type, wait, then submit as a separate keystroke.
 */
const SUBMIT_DELAY_MS = 400;

/** v1 runtime: each agent is a tmux pane; wake = send-keys nudge. */
export class PanesRuntime implements Runtime {
  /** Whether the tmux session exists yet (the first agent creates it). */
  private sessionCreated = false;
  /** window name → stable tmux window id (`#{window_id}`), captured at spawn. */
  private windowIds = new Map<string, string>();
  /** agentId → stable tmux pane id (`#{pane_id}`), for send-keys/wake targeting. */
  private paneIds = new Map<string, string>();

  constructor(
    private tmux: TmuxCommands,
    private session: string,
    private engines: EngineRegistry,
    private sleeper: Sleeper,
  ) {}

  /**
   * Type literal text into a pane, then submit Enter as a SEPARATE send-keys
   * call after a short delay — so engines that race the Enter against rendering
   * (codex, cursor-agent) reliably auto-submit. `-l` keeps the text literal.
   */
  private async typeAndSubmit(target: string, text: string): Promise<void> {
    this.tmux.run(["send-keys", "-t", target, "-l", text]);
    await this.sleeper.sleep(SUBMIT_DELAY_MS);
    this.tmux.run(["send-keys", "-t", target, "Enter"]);
  }

  async spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void> {
    const p = this.engines.get(agent.engine);
    if (!p) throw new Error(`unknown engine: ${agent.engine}`);
    const profileEnv = Object.entries(p.env ?? {}).map(([k, v]) => `${k}=${v} `).join("");
    const args = p.args?.length ? " " + p.args.join(" ") : "";
    const launch = `TEAM_AGENT_ID=${agent.id} TEAM_SOCKET=${ctx.socketPath} ${profileEnv}${p.command}${args}`;
    // Agents sharing a `window` value share one tmux window (each its own pane);
    // an omitted window defaults to the agent id → one window per agent.
    const windowName = ctx.config.agents.find((a) => a.id === agent.id)?.window ?? agent.id;
    // Run the engine at the PROJECT ROOT so it operates on the whole project, not
    // its near-empty shared/<id> dir. The role file still lives in shared/<id>.
    const paneId = this.placePane(windowName, ctx.projectRoot, ctx.config.layout);
    this.paneIds.set(agent.id, paneId);
    await this.typeAndSubmit(paneId, launch);
  }

  async wake(agentId: string, summary: string): Promise<void> {
    // Target the stable pane id — tmux automatic-rename breaks session:name.
    const target = this.paneIds.get(agentId) ?? `${this.session}:${agentId}`;
    // No leading `#`: Claude Code treats a `#`-prefixed line as "add to memory",
    // which would swallow the nudge instead of acting on it. Include the agent
    // id so it can read its own inbox directly (works without AGENT_ID in-pane).
    await this.typeAndSubmit(target, `▶ new mail (${summary}) — run: team inbox ${agentId} to read and act on it`);
  }

  async teardown(): Promise<void> {
    this.tmux.run(["kill-session", "-t", this.session]);
  }

  /**
   * Place a pane for an agent in its window and return the pane's stable id.
   * The first agent in a window opens it (`new-session` for the very first
   * window, `new-window` after); subsequent agents in the same window add a
   * pane via `split-window` and the window is re-laid-out with its configured
   * layout (default `even-horizontal`). new-session/new-window print
   * "window_id pane_id"; split-window prints the new pane_id.
   */
  private placePane(windowName: string, workdir: string, layout: Record<string, string>): string {
    const windowId = this.windowIds.get(windowName);
    if (windowId !== undefined) {
      const paneId = this.tmux.run(
        ["split-window", "-t", windowId, "-c", workdir, "-P", "-F", "#{pane_id}"],
      ).trim();
      this.tmux.run(["select-layout", "-t", windowId, layout[windowName] ?? DEFAULT_LAYOUT]);
      return paneId;
    }
    const capture = ["-P", "-F", "#{window_id} #{pane_id}"];
    const out = this.sessionCreated
      ? this.tmux.run(["new-window", "-t", this.session, "-n", windowName, "-c", workdir, ...capture])
      : this.tmux.run(["new-session", "-d", "-s", this.session, "-n", windowName, "-c", workdir, ...capture]);
    this.sessionCreated = true;
    const [winId, paneId] = out.trim().split(/\s+/);
    this.windowIds.set(windowName, winId!);
    return paneId!;
  }
}
