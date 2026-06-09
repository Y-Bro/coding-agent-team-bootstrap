import { test } from "node:test";
import assert from "node:assert/strict";
import { PanesRuntime } from "../../src/runtime/panes.ts";
import type { TmuxCommands } from "../../src/ports/tmux.ts";
import type { AgentCard } from "../../src/a2a/index.ts";
import type { TeamConfig } from "../../src/config/index.ts";
import type { SpawnCtx } from "../../src/runtime/runtime.ts";
import { resolveEngines } from "../../src/engines/index.ts";

class FakeTmux implements TmuxCommands {
  calls: string[][] = [];
  private win = 0; private pane = 0;
  run(args: string[]): string {
    this.calls.push(args);
    if (args[0] === "new-session" || args[0] === "new-window") return `@${++this.win} %${++this.pane}\n`;
    if (args[0] === "split-window") return `%${++this.pane}\n`;
    return "";
  }
}
const noSleep = { sleep: async () => {} } as const;
const card: AgentCard = { id: "lead", role: "orchestrator", cli: "claude", engine: "claude",
  capabilities: [], skills: [], workdir: "/proj/shared/lead", subscribes: [] };
function cfg(): TeamConfig {
  return { agents: [{ id: "lead" }], layout: {} } as unknown as TeamConfig;
}
function ctx(): SpawnCtx {
  return { config: cfg(), socketPath: "/tmp/s.sock", projectRoot: "/proj" };
}

test("spawn opens the pane at the project root, not shared/<id>", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "t", resolveEngines({}), noSleep);
  await rt.spawn(card, ctx());
  const create = tmux.calls.find((c) => c[0] === "new-session" || c[0] === "new-window")!;
  const cwd = create[create.indexOf("-c") + 1];
  assert.equal(cwd, "/proj", "pane cwd must be the project root");
  assert.notEqual(cwd, "/proj/shared/lead");
});

test("after launch, spawn injects a bootstrap message with commands + role-file pointer", async () => {
  const tmux = new FakeTmux();
  const rt = new PanesRuntime(tmux, "t", resolveEngines({}), noSleep);
  await rt.spawn(card, ctx());
  // literal-text send-keys payloads, in order: [0] = launch command, [1] = bootstrap message
  const texts = tmux.calls
    .filter((c) => c[0] === "send-keys" && c.includes("-l"))
    .map((c) => c[c.indexOf("-l") + 1]!);
  assert.equal(texts.length, 2, "launch command, then bootstrap message");
  const boot = texts[1]!;
  assert.ok(boot.includes("lead"), "names the agent");
  assert.ok(boot.includes("team inbox lead"), "inline read-mail command");
  assert.ok(boot.includes("team send --to"), "inline send command");
  assert.ok(boot.includes("/proj/shared/lead/CLAUDE.md"), "absolute role-file pointer");
  assert.ok(boot.includes("/proj") && /only inside/i.test(boot), "pins the working dir to root");
  assert.ok(!boot.trimStart().startsWith("#"), "no Claude memory-prefix");
});
