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
  run(_args: string[]): string { return ""; }
}

class SpyRuntime implements Runtime {
  async spawn(_a: AgentCard, _c: SpawnCtx): Promise<void> {}
  async wake(): Promise<void> {}
  async teardown(): Promise<void> {}
}

function fixture() {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const fs = new MemoryFs();
  const templates = { writer: "# {{id}} writer", reviewer: "# {{id}} reviewer", lead: "# {{id}} lead" };
  const boot = new Bootstrapper(cfg, {
    runtime: new SpyRuntime(), git: new SpyGit(), fs,
    engines: resolveEngines({}), templates, register: () => {},
  });
  return { boot, fs };
}

// lead: workdir ".", claude → CLAUDE.md.  fe-writer: workdir "frontend", claude → frontend/CLAUDE.md.

test("up preserves a role file that was already scaffolded (never-overwrite)", async () => {
  const { boot, fs } = fixture();
  const scaffolded = "# lead\n\nRich per-agent guidance from `team new` that must not be clobbered.\n";
  fs.write("CLAUDE.md", scaffolded); // pre-seed lead's role file (as ContextScaffolder would)

  await boot.up(".team/broker.sock");

  assert.equal(fs.read("CLAUDE.md"), scaffolded);
});

test("up still generates a role file when none exists (hand-written team.yaml)", async () => {
  const { boot, fs } = fixture();
  assert.equal(fs.exists("frontend/CLAUDE.md"), false); // absent up front

  await boot.up(".team/broker.sock");

  assert.ok(fs.exists("frontend/CLAUDE.md"));
  assert.match(fs.read("frontend/CLAUDE.md"), /# fe-writer writer/);
});
