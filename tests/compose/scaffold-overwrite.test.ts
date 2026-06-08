import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { runScaffoldCommand } from "../../src/compose.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { FakeCommandRunner } from "../../src/ports/command.ts";

test("existing team.yaml + no --force + 'n' → not overwritten, no context files written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-ovr-"));
  const out = join(dir, "team.yaml");
  writeFileSync(out, "ORIGINAL", "utf8");
  const prompter = new ScriptedPrompter(["n"]); // overwrite? -> no
  const runner = new FakeCommandRunner({ code: 0, stdout: "G", stderr: "", timedOut: false });

  await runScaffoldCommand({ out }, { prompter, runner });

  assert.equal(readFileSync(out, "utf8"), "ORIGINAL"); // untouched
  assert.ok(!existsSync(join(dir, "CLAUDE.md")));       // no context files written
  assert.equal(runner.calls.length, 0);                 // no generation spawned
});

test("existing team.yaml + --force → overwritten with the scaffolded config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-ovr-"));
  const out = join(dir, "team.yaml");
  writeFileSync(out, "ORIGINAL", "utf8");
  // full solo wizard: name, runtime(1), preset(1=solo), engine, window(agent), confirm-up=n
  const prompter = new ScriptedPrompter(["demo", "1", "1", "claude", "agent", "n"]);
  const runner = new FakeCommandRunner({ code: 0, stdout: "G", stderr: "", timedOut: false });

  await runScaffoldCommand({ out, force: true, noGuidance: true }, { prompter, runner });

  const cfg = parse(readFileSync(out, "utf8"));
  assert.equal(cfg.root, ".");
  assert.equal(cfg.name, "demo");
  assert.notEqual(readFileSync(out, "utf8"), "ORIGINAL");
});
