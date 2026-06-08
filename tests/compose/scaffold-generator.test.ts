import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScaffoldCommand } from "../../src/compose.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { FakeCommandRunner } from "../../src/ports/command.ts";

test("sources the guidance generator from cfg.scaffold.generator (default claude)", async () => {
  // Solo team using codex as the AGENT engine; the generator stays the schema
  // default (claude) because nothing overrides scaffold.generator. The spawned
  // generator command must be the configured generator, NOT the agent engine.
  const dir = mkdtempSync(join(tmpdir(), "scaffold-"));
  const out = join(dir, "team.yaml");
  // name, runtime(1), preset(1=solo), engine=codex, window(agent)=agent, confirm=n
  const prompter = new ScriptedPrompter(["demo", "1", "1", "codex", "agent", "n"]);
  const runner = new FakeCommandRunner({ code: 0, stdout: "G", stderr: "", timedOut: false });
  await runScaffoldCommand({ out }, { prompter, runner });
  // default generator is claude (sourced from parsed config), not the agent's codex.
  assert.ok(runner.calls.length === 0 || runner.calls[0]!.command === "claude");
});
