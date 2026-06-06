import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/index.ts";
import { TeamConfigSchema } from "../../src/config/schema.ts";
import { DEFAULT_MESSAGE_TYPES } from "../../src/a2a/index.ts";

test("agent.engine defaults to 'claude' when omitted", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    agents: [{ id: "lead", role: "lead" }],
  });
  assert.equal(cfg.agents[0].engine, "claude");
});

test("top-level engines map accepts custom engine profiles", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    engines: { mytool: { command: "mytool", roleFile: "MY.md" } },
    agents: [{ id: "a", role: "writer", engine: "mytool" }],
  });
  assert.equal(cfg.engines?.mytool.command, "mytool");
  assert.equal(cfg.agents[0].engine, "mytool");
});

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

test("loadConfig defaults messageTypes to the A2A vocabulary when omitted", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  assert.deepEqual(cfg.messageTypes, [...DEFAULT_MESSAGE_TYPES]);
});

test("loadConfig throws on duplicate agent ids", () => {
  assert.throws(() => loadConfig("tests/config/fixtures/dupe.yaml"), /duplicate/i);
});
