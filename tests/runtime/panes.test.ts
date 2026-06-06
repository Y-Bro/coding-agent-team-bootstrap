import { test } from "node:test";
import assert from "node:assert/strict";
import { PanesRuntime } from "../../src/runtime/panes.ts";
import type { TmuxCommands } from "../../src/ports/tmux.ts";
import type { AgentCard } from "../../src/a2a/index.ts";

class SpyTmux implements TmuxCommands {
  calls: string[][] = [];
  run(args: string[]): string { this.calls.push(args); return ""; }
}

const card: AgentCard = { id: "fe-writer", role: "writer", cli: "claude",
  capabilities: [], skills: [], workdir: "frontend", subscribes: [] };

test("wake sends a one-line nudge into the agent's pane", async () => {
  const tmux = new SpyTmux();
  const rt = new PanesRuntime(tmux, "todo");
  await rt.wake("fe-writer", "review_comment from fe-reviewer");
  const sendKeys = tmux.calls.find((c) => c[0] === "send-keys")!;
  assert.ok(sendKeys.join(" ").includes("fe-writer"));
  assert.ok(sendKeys.join(" ").includes("team inbox"));
});

test("spawn launches the agent's CLI in a named pane with env", async () => {
  const tmux = new SpyTmux();
  const rt = new PanesRuntime(tmux, "todo");
  await rt.spawn(card, { config: {} as any, socketPath: ".team/broker.sock" });
  assert.ok(tmux.calls.some((c) => c.join(" ").includes("claude")));
});
