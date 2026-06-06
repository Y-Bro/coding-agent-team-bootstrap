// tests/e2e/init.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { runWizard, writeConfigYaml } from "../../src/cli/wizard.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { resolveEngines } from "../../src/engines/index.ts";
import { TeamConfigSchema } from "../../src/config/schema.ts";

test("init writes a team.yaml that loads back through the m1 schema", async () => {
  const dir = await mkdtemp(join(tmpdir(), "init-e2e-"));
  const out = join(dir, "team.yaml");
  const prompter = new ScriptedPrompter(["demo", "1", "claude"]); // solo preset, claude
  const cfg = await runWizard({
    prompter,
    engines: resolveEngines({}),
    available: new Set(["claude"]),
  });
  await writeConfigYaml(out, cfg);
  const reloaded = TeamConfigSchema.parse(parse(await readFile(out, "utf8")));
  assert.equal(reloaded.name, "demo");
  assert.equal(reloaded.agents[0]!.engine, "claude");
});
