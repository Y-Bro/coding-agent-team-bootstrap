import { test } from "node:test";
import assert from "node:assert/strict";
import { PanesRuntime } from "../../src/runtime/panes.ts";
import type { TmuxCommands } from "../../src/ports/tmux.ts";
import type { AgentCard } from "../../src/a2a/index.ts";
import { resolveEngines } from "../../src/engines/index.ts";

class SpyTmux implements TmuxCommands {
  calls: string[][] = [];
  run(args: string[]): string { this.calls.push(args); return ""; }
}

/** Fake tmux that hands back a stable window id for each new-session/new-window. */
class FakeTmux implements TmuxCommands {
  calls: string[][] = [];
  private ids = ["@1", "@2", "@3"];
  private i = 0;
  run(args: string[]): string {
    this.calls.push(args);
    if (args[0] === "new-session" || args[0] === "new-window") return `${this.ids[this.i++] ?? "@x"}\n`;
    return "";
  }
}

const card: AgentCard = { id: "fe-writer", role: "writer", cli: "claude", engine: "claude",
  capabilities: [], skills: [], workdir: "frontend", subscribes: [] };

test("wake sends a one-line nudge into the agent's pane", async () => {
  const tmux = new SpyTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}));
  await rt.wake("fe-writer", "review_comment from fe-reviewer");
  const sendKeys = tmux.calls.find((c) => c[0] === "send-keys")!;
  assert.ok(sendKeys.join(" ").includes("fe-writer"));
  assert.ok(sendKeys.join(" ").includes("team inbox"));
});

test("spawn launches the agent's CLI in a named pane with env", async () => {
  const tmux = new SpyTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}));
  await rt.spawn(card, { config: {} as any, socketPath: ".team/broker.sock" });
  assert.ok(tmux.calls.some((c) => c.join(" ").includes("claude")));
});

test("creates the tmux session once for the first agent, then adds windows", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}));
  await rt.spawn({ ...card, id: "a" }, { config: {} as any, socketPath: "/tmp/s.sock" });
  await rt.spawn({ ...card, id: "b" }, { config: {} as any, socketPath: "/tmp/s.sock" });

  const creators = tmux.calls.filter((c) => c[0] === "new-session" || c[0] === "new-window");
  assert.equal(creators.filter((c) => c[0] === "new-session").length, 1, "exactly one new-session");
  const sess = creators.find((c) => c[0] === "new-session")!;
  assert.deepEqual([sess[2], sess[3], sess[4], sess[5]], ["-s", "todo", "-n", "a"]); // -s todo -n a
  const win = creators.find((c) => c[0] === "new-window")!;
  assert.equal(win.includes("b"), true);
  // both capture a stable window id
  for (const c of creators) assert.deepEqual(c.slice(-3), ["-P", "-F", "#{window_id}"]);
});

test("targets send-keys by captured window id, not session:name", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}));
  await rt.spawn({ ...card, id: "a" }, { config: {} as any, socketPath: "/tmp/s.sock" });

  const sendKeys = tmux.calls.find((c) => c[0] === "send-keys")!;
  assert.deepEqual([sendKeys[1], sendKeys[2]], ["-t", "@1"]); // id, not "todo:a"
});

test("wake targets the captured window id (survives tmux automatic-rename)", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}));
  await rt.spawn({ ...card, id: "a" }, { config: {} as any, socketPath: "/tmp/s.sock" });
  // a rename would break "todo:a" targeting; the window id is stable.
  await rt.wake("a", "review_comment from b");

  const wake = tmux.calls.filter((c) => c[0] === "send-keys").at(-1)!;
  assert.deepEqual([wake[1], wake[2]], ["-t", "@1"]);
});

test("spawn launches the agent engine's command", async () => {
  const tmux = new SpyTmux();
  const engines = resolveEngines({});
  const rt = new PanesRuntime(tmux, "t", engines);
  const codexCard: AgentCard = { ...card, id: "a", engine: "codex" };
  await rt.spawn(codexCard, { config: {} as any, socketPath: "/tmp/t.sock" });
  const sent = tmux.calls.filter((c) => c[0] === "send-keys").map((c) => c[3]);
  assert.ok(sent.some((k) => k?.includes("codex")), `expected codex launch, got ${sent}`);
});
