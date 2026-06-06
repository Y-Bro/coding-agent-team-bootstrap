// tests/cli/wizard.test.ts  (create file; first the prompter fake sanity)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";

test("ScriptedPrompter returns queued answers in order", async () => {
  const p = new ScriptedPrompter(["alice", "2"]);
  assert.equal(await p.ask("name?"), "alice");
  assert.equal(await p.select("count?", ["1", "2", "3"]), "2");
});
