import { test } from "node:test";
import assert from "node:assert/strict";
import { planTopology } from "../../src/bootstrap/topology.ts";
import { loadConfig } from "../../src/config/index.ts";

test("plans one pane per agent plus extra windows", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const plan = planTopology(cfg);
  assert.deepEqual(plan.agentPanes.map((p) => p.agentId), ["lead", "fe-writer", "fe-reviewer"]);
  assert.deepEqual(plan.extraWindows, ["servers", "git"]);
  assert.equal(plan.session, "todo");
});

test("resolves pane workdirs against a base dir when given (run-from-anywhere)", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const plan = planTopology(cfg, "/proj");
  const lead = plan.agentPanes.find((p) => p.agentId === "lead")!;
  assert.equal(lead.workdir, "/proj");
  const fe = plan.agentPanes.find((p) => p.agentId === "fe-writer")!;
  assert.equal(fe.workdir, "/proj/frontend");
});
