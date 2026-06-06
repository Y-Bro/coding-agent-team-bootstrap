import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRoleFile, toCard } from "../../src/bootstrap/roles.ts";
import { loadConfig } from "../../src/config/index.ts";

test("renders a role file from template with agent specifics", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const fe = cfg.agents.find((a) => a.id === "fe-writer")!;
  const template = "# {{id}} ({{role}})\nCapabilities: {{capabilities}}\nRun `team inbox` for mail.";
  const out = renderRoleFile(template, fe);
  assert.match(out, /# fe-writer \(writer\)/);
  assert.match(out, /Capabilities: frontend, react/);
});

test("toCard projects an AgentConfig into an AgentCard", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const card = toCard(cfg.agents.find((a) => a.id === "fe-reviewer")!);
  assert.equal(card.id, "fe-reviewer");
  assert.equal(card.cli, "codex");
  assert.deepEqual(card.subscribes, ["review_request"]);
});
