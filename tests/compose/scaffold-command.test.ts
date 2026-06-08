import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { runScaffoldCommand } from "../../src/compose.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { FakeCommandRunner } from "../../src/ports/command.ts";

test("scaffolds team.yaml (windows, layout, root) and context files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-"));
  const out = join(dir, "team.yaml");
  // wizard answers: name, runtime(1=panes), preset(2=lead+writer+reviewer), engine x3
  // layout answers: window(lead)=lead, window(writer)=build, window(reviewer)=build, layout(build)=even-horizontal
  const prompter = new ScriptedPrompter([
    "demo", "1", "2", "claude", "claude", "codex",
    "lead", "build", "build", "even-horizontal",
    "n", // confirm up? no
  ]);
  const runner = new FakeCommandRunner({ code: 0, stdout: "ROLE GUIDE", stderr: "", timedOut: false });

  await runScaffoldCommand({ out }, { prompter, runner });

  const cfg = parse(readFileSync(out, "utf8"));
  assert.equal(cfg.root, ".");
  assert.equal(cfg.agents.find((a: any) => a.id === "writer").window, "build");
  assert.equal(cfg.layout.build, "even-horizontal");
  // each agent's md lands under its own shared/<id>/ workdir (no same-engine collision)
  assert.ok(existsSync(join(dir, "shared/lead/CLAUDE.md")));       // lead (claude)
  assert.ok(existsSync(join(dir, "shared/reviewer/AGENTS.md")));   // reviewer (codex)
  assert.ok(readFileSync(join(dir, "shared/lead/CLAUDE.md"), "utf8").startsWith("ROLE GUIDE"));
});

test("--no-guidance writes wiring-only with no engine spawn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-"));
  const out = join(dir, "team.yaml");
  const prompter = new ScriptedPrompter(["demo", "1", "1", "claude", "agent", "n"]);
  const runner = new FakeCommandRunner({ code: 0, stdout: "GUIDE", stderr: "", timedOut: false });

  await runScaffoldCommand({ out, noGuidance: true }, { prompter, runner });

  assert.equal(runner.calls.length, 0);
  assert.ok(readFileSync(join(dir, "shared/agent/CLAUDE.md"), "utf8").startsWith("## Team wiring"));
});
