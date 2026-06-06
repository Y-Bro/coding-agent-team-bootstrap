import { test } from "node:test";
import assert from "node:assert/strict";
import { Bootstrapper } from "../../src/bootstrap/bootstrapper.ts";
import { loadConfig } from "../../src/config/index.ts";
import { MemoryFs } from "../ports/fakes.ts";
import type { GitCommands } from "../../src/ports/git.ts";
import type { Runtime, SpawnCtx } from "../../src/runtime/runtime.ts";
import type { AgentCard } from "../../src/a2a/index.ts";
import { resolveEngines } from "../../src/engines/index.ts";

class SpyGit implements GitCommands {
  calls: string[][] = [];
  run(args: string[]): string { this.calls.push(args); return ""; }
}

class SpyRuntime implements Runtime {
  spawned: string[] = [];
  tornDown = false;
  async spawn(a: AgentCard, _c: SpawnCtx): Promise<void> { this.spawned.push(a.id); }
  async wake(): Promise<void> {}
  async teardown(): Promise<void> { this.tornDown = true; }
}

function fixture() {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const fs = new MemoryFs();
  const git = new SpyGit();
  const runtime = new SpyRuntime();
  const registered: string[] = [];
  const register = (card: AgentCard) => { registered.push(card.id); };
  const templates = { writer: "# {{id}} writer", reviewer: "# {{id}} reviewer", lead: "# {{id}} lead" };
  return { boot: new Bootstrapper(cfg, { runtime, git, fs, engines: resolveEngines({}), templates, register }), cfg, fs, git, runtime, registered };
}

test("up creates worktrees, writes a card + role file per agent, and spawns each", async () => {
  const { boot, fs, git, runtime } = fixture();
  await boot.up(".team/broker.sock");

  // worktree added only for the agent that declares one
  assert.equal(git.calls.filter((c) => c[0] === "worktree" && c[1] === "add").length, 1);

  // a card per agent
  assert.ok(fs.exists(".team/cards/lead.json"));
  assert.ok(fs.exists(".team/cards/fe-writer.json"));
  assert.ok(fs.exists(".team/cards/fe-reviewer.json"));
  const card = JSON.parse(fs.read(".team/cards/fe-reviewer.json"));
  assert.equal(card.cli, "codex");

  // role files rendered from the per-role template; lead has its own dir (".")
  assert.match(fs.read("./CLAUDE.md"), /# lead lead/);
  // fe-writer + fe-reviewer intentionally share the 'frontend' worktree, so the
  // role file there is written for whichever agent the bootstrapper handles last.
  assert.ok(fs.exists("frontend/CLAUDE.md"));

  // every agent spawned
  assert.deepEqual(runtime.spawned, ["lead", "fe-writer", "fe-reviewer"]);
});

test("up registers every agent's card with the broker (so team ps/send work in panes)", async () => {
  const { boot, registered } = fixture();
  await boot.up(".team/broker.sock");
  assert.deepEqual(registered, ["lead", "fe-writer", "fe-reviewer"]);
});

test("down tears the runtime down", async () => {
  const { boot, runtime } = fixture();
  await boot.down();
  assert.equal(runtime.tornDown, true);
});
