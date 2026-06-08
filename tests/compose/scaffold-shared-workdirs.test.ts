import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { runScaffoldCommand } from "../../src/compose.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { FakeCommandRunner } from "../../src/ports/command.ts";

test("each agent gets workdir shared/<id> and its own md under shared/<id>/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shared-"));
  const out = join(dir, "team.yaml");
  // wizard: name, runtime(1=panes), preset(2=lead+writer+reviewer), 3 engines,
  // layout: window(lead), window(writer), window(reviewer), layout(build), confirm(n)
  const prompter = new ScriptedPrompter([
    "demo", "1", "2", "claude", "claude", "codex",
    "lead", "build", "build", "even-horizontal", "n",
  ]);
  const runner = new FakeCommandRunner({ code: 0, stdout: "GUIDE", stderr: "", timedOut: false });
  await runScaffoldCommand({ out }, { prompter, runner });

  const cfg = parse(readFileSync(out, "utf8"));
  assert.equal(cfg.agents.find((a: any) => a.id === "lead").workdir, "shared/lead");
  assert.equal(cfg.agents.find((a: any) => a.id === "writer").workdir, "shared/writer");
  assert.equal(cfg.agents.find((a: any) => a.id === "reviewer").workdir, "shared/reviewer");

  // distinct dirs → every agent gets its own md, no collision/skip
  assert.ok(existsSync(join(dir, "shared/lead/CLAUDE.md")));
  assert.ok(existsSync(join(dir, "shared/writer/CLAUDE.md")));
  assert.ok(existsSync(join(dir, "shared/reviewer/AGENTS.md")));
  assert.ok(readFileSync(join(dir, "shared/writer/CLAUDE.md"), "utf8").startsWith("GUIDE"));
});
