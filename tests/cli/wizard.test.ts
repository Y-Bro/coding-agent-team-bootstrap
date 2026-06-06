// tests/cli/wizard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { runWizard, writeConfigYaml } from "../../src/cli/wizard.ts";
import { resolveEngines } from "../../src/engines/index.ts";
import { TeamConfigSchema } from "../../src/config/schema.ts";
import { formatDoctorReport } from "../../src/cli/doctor-cmd.ts";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

test("ScriptedPrompter returns queued answers in order", async () => {
  const p = new ScriptedPrompter(["alice", "2"]);
  assert.equal(await p.ask("name?"), "alice");
  assert.equal(await p.select("count?", ["1", "2", "3"]), "2");
});

test("wizard with the lead+writer+reviewer preset emits a schema-valid config", async () => {
  const prompter = new ScriptedPrompter([
    "demo",        // team name
    "2",           // preset: lead+writer+reviewer
    "claude",      // lead engine
    "claude",      // writer engine
    "codex",       // reviewer engine
  ]);
  const engines = resolveEngines({});
  const cfg = await runWizard({
    prompter,
    engines,
    available: new Set(["claude", "codex"]),
  });
  const parsed = TeamConfigSchema.parse(cfg);
  assert.equal(parsed.name, "demo");
  assert.equal(parsed.agents.length, 3);
  assert.deepEqual(parsed.agents.map((a) => a.role), ["lead", "writer", "reviewer"]);
  assert.equal(parsed.agents[2].engine, "codex");
});

test("writeConfigYaml round-trips through yaml.parse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wizard-"));
  const out = join(dir, "team.yaml");
  await writeConfigYaml(out, { name: "x", agents: [{ id: "a", role: "writer", engine: "claude" }] });
  const reloaded = parse(await readFile(out, "utf8"));
  assert.equal(reloaded.name, "x");
});

test("formatDoctorReport prints blockers and engine availability", () => {
  const out = formatDoctorReport({
    ok: false,
    blockers: ["missing required tool: tmux (install it and re-run)"],
    enginesPresent: { claude: true, codex: false },
  });
  assert.match(out, /tmux/);
  assert.match(out, /claude.*(✓|yes|present)/i);
  assert.match(out, /codex.*(✗|no|missing)/i);
});
