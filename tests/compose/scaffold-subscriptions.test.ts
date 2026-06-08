import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { runScaffoldCommand } from "../../src/compose.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { DEFAULT_MESSAGE_TYPES } from "../../src/a2a/index.ts";

test("first agent (orchestrator) subscribes to all types; others subscribe to none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subs-"));
  const out = join(dir, "team.yaml");
  // custom shape: 3 agents, all claude. answers: name, runtime(1), preset(4=custom),
  // count(3), id+role+engine x3, then layout windows x3 + (solo windows: no layout), confirm n
  const prompter = new ScriptedPrompter([
    "demo", "1", "4", "3",
    "boss", "orchestrator", "claude",
    "a1", "engineer", "claude",
    "a2", "engineer", "claude",
    "boss", "a1", "a2",   // each its own window -> no layout prompts
    "n",
  ]);
  await runScaffoldCommand({ out, noGuidance: true }, { prompter });
  const cfg = parse(readFileSync(out, "utf8"));
  const boss = cfg.agents.find((a: any) => a.id === "boss");
  const a1 = cfg.agents.find((a: any) => a.id === "a1");
  assert.deepEqual([...boss.subscribes].sort(), [...DEFAULT_MESSAGE_TYPES].sort());
  assert.deepEqual(a1.subscribes, []);
});
