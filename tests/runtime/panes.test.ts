import { test } from "node:test";
import assert from "node:assert/strict";
import { PanesRuntime } from "../../src/runtime/panes.ts";
import type { TmuxCommands } from "../../src/ports/tmux.ts";
import type { AgentCard } from "../../src/a2a/index.ts";
import type { TeamConfig } from "../../src/config/index.ts";
import type { SpawnCtx } from "../../src/runtime/runtime.ts";
import { resolveEngines } from "../../src/engines/index.ts";

class SpyTmux implements TmuxCommands {
  calls: string[][] = [];
  run(args: string[]): string { this.calls.push(args); return ""; }
}

/** No-op sleeper: the type→Enter submit delay is irrelevant to these assertions. */
const noSleep = { sleep: async () => {} } as const;

/**
 * Fake tmux that hands back stable ids. new-session/new-window print
 * "window_id pane_id" (the window's first pane); split-window prints a pane_id.
 */
class FakeTmux implements TmuxCommands {
  calls: string[][] = [];
  private win = 0;
  private pane = 0;
  run(args: string[]): string {
    this.calls.push(args);
    if (args[0] === "new-session" || args[0] === "new-window") return `@${++this.win} %${++this.pane}\n`;
    if (args[0] === "split-window") return `%${++this.pane}\n`;
    return "";
  }
}

const card: AgentCard = { id: "fe-writer", role: "writer", cli: "claude", engine: "claude",
  capabilities: [], skills: [], workdir: "frontend", subscribes: [] };

/** Minimal config carrying per-agent `window` + a `layout` map for the runtime. */
function cfgWith(agents: Array<{ id: string; window?: string }>, layout: Record<string, string> = {}): TeamConfig {
  return { agents: agents.map((a) => ({ id: a.id, window: a.window })), layout } as unknown as TeamConfig;
}
function ctx(config: TeamConfig): SpawnCtx { return { config, socketPath: "/tmp/s.sock", projectRoot: "/proj" }; }

test("wake sends a one-line nudge into the agent's pane", async () => {
  const tmux = new SpyTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}), noSleep);
  await rt.wake("fe-writer", "review_comment from fe-reviewer");
  // The literal-text payload is the arg right after `-l`.
  const textSend = tmux.calls.find((c) => c[0] === "send-keys" && c.includes("-l"))!;
  const text = textSend[textSend.indexOf("-l") + 1]!;
  // Must NOT start with `#` — Claude Code treats a leading `#` as "add to memory",
  // which swallows the nudge so claude agents never act on it.
  assert.ok(!text.trimStart().startsWith("#"), `nudge must not start with #, got: ${text}`);
  // Still actionable: tells the agent to read its own inbox.
  assert.ok(text.includes("team inbox"));
  assert.ok(text.includes("fe-writer"));
});

test("spawn launches the agent's CLI in a named pane with env", async () => {
  const tmux = new SpyTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}), noSleep);
  await rt.spawn(card, ctx(cfgWith([{ id: "fe-writer" }])));
  assert.ok(tmux.calls.some((c) => c.join(" ").includes("claude")));
});

test("default (no window): one window per agent, no splits", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}), noSleep);
  const config = cfgWith([{ id: "a" }, { id: "b" }]);
  await rt.spawn({ ...card, id: "a" }, ctx(config));
  await rt.spawn({ ...card, id: "b" }, ctx(config));

  assert.equal(tmux.calls.filter((c) => c[0] === "new-session").length, 1, "one new-session");
  assert.equal(tmux.calls.filter((c) => c[0] === "new-window").length, 1, "one new-window for the 2nd agent");
  assert.equal(tmux.calls.filter((c) => c[0] === "split-window").length, 0, "no splits");
  const sess = tmux.calls.find((c) => c[0] === "new-session")!;
  assert.deepEqual([sess[2], sess[3], sess[4], sess[5]], ["-s", "todo", "-n", "a"]);
  // both creators capture window id + pane id
  for (const c of tmux.calls.filter((c) => c[0] === "new-session" || c[0] === "new-window")) {
    assert.deepEqual(c.slice(-3), ["-P", "-F", "#{window_id} #{pane_id}"]);
  }
});

test("agents sharing a window become panes in ONE window via split-window + select-layout", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}), noSleep);
  const config = cfgWith([{ id: "a", window: "pair" }, { id: "b", window: "pair" }]);
  await rt.spawn({ ...card, id: "a" }, ctx(config));
  await rt.spawn({ ...card, id: "b" }, ctx(config));

  // one window total (the session's first), and the second agent splits it
  assert.equal(tmux.calls.filter((c) => c[0] === "new-session").length, 1);
  assert.equal(tmux.calls.filter((c) => c[0] === "new-window").length, 0);
  const split = tmux.calls.find((c) => c[0] === "split-window")!;
  assert.deepEqual([split[1], split[2]], ["-t", "@1"], "splits the shared window id");
  // a layout is applied to the shared window after the split (default even-horizontal)
  const layout = tmux.calls.find((c) => c[0] === "select-layout")!;
  assert.deepEqual(layout, ["select-layout", "-t", "@1", "even-horizontal"]);
  // each agent targets its own pane (the literal-text send-keys, one per agent)
  const textSends = tmux.calls.filter((c) => c[0] === "send-keys" && c.includes("-l"));
  assert.deepEqual([textSends[0]![1], textSends[0]![2]], ["-t", "%1"]);
  assert.deepEqual([textSends[1]![1], textSends[1]![2]], ["-t", "%2"]);
});

test("select-layout uses the configured layout for the window", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}), noSleep);
  const config = cfgWith([{ id: "a", window: "pair" }, { id: "b", window: "pair" }], { pair: "main-vertical" });
  await rt.spawn({ ...card, id: "a" }, ctx(config));
  await rt.spawn({ ...card, id: "b" }, ctx(config));
  const layout = tmux.calls.find((c) => c[0] === "select-layout")!;
  assert.equal(layout.at(-1), "main-vertical");
});

test("targets send-keys by captured pane id, not session:name", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}), noSleep);
  await rt.spawn({ ...card, id: "a" }, ctx(cfgWith([{ id: "a" }])));
  const sendKeys = tmux.calls.find((c) => c[0] === "send-keys")!;
  assert.deepEqual([sendKeys[1], sendKeys[2]], ["-t", "%1"]);
});

test("wake targets the captured pane id (survives tmux automatic-rename)", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "todo", resolveEngines({}), noSleep);
  await rt.spawn({ ...card, id: "a" }, ctx(cfgWith([{ id: "a" }])));
  await rt.wake("a", "review_comment from b");
  const wake = tmux.calls.filter((c) => c[0] === "send-keys").at(-1)!;
  assert.deepEqual([wake[1], wake[2]], ["-t", "%1"]);
});

test("spawn launches the agent engine's command", async () => {
  const tmux = new SpyTmux();
  const rt = new PanesRuntime(tmux, "t", resolveEngines({}), noSleep);
  const codexCard: AgentCard = { ...card, id: "a", engine: "codex" };
  await rt.spawn(codexCard, ctx(cfgWith([{ id: "a" }])));
  const sent = tmux.calls.filter((c) => c[0] === "send-keys").map((c) => c.join(" "));
  assert.ok(sent.some((k) => k.includes("codex")), `expected codex launch, got ${sent}`);
});
