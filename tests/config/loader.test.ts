import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/index.ts";

test("loadConfig parses and defaults a valid team.yaml", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  assert.equal(cfg.name, "todo");
  assert.equal(cfg.runtime, "panes");
  assert.equal(cfg.agents.length, 3);
  const fe = cfg.agents.find((a) => a.id === "fe-writer")!;
  assert.equal(fe.worktree?.branch, "feat/frontend");
  assert.deepEqual(fe.capabilities, ["frontend", "react"]);
  assert.deepEqual(cfg.agents[0]!.subscribes, []);
});

test("loadConfig throws on duplicate agent ids", () => {
  assert.throws(() => loadConfig("tests/config/fixtures/dupe.yaml"), /duplicate/i);
});
