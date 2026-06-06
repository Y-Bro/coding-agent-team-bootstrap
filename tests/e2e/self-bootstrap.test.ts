import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/index.ts";
import { planTopology } from "../../src/bootstrap/topology.ts";

const META = "examples/agent-bootstrap-team.yaml";

// Dogfood proof: the committed meta team.yaml parses under the REAL schema and
// plans exactly this repo's 3-agent build team. Parse + plan only — NO team up.
test("self-bootstrap meta team.yaml parses under the real schema", () => {
  const cfg = loadConfig(META);
  assert.equal(cfg.name, "agent-bootstrap");
  assert.equal(cfg.runtime, "panes");
  assert.equal(cfg.broker.transport, "unix");
  assert.equal(cfg.agents.length, 3);
});

test("planTopology yields exactly lead/writer/reviewer with their clis", () => {
  const cfg = loadConfig(META);
  const plan = planTopology(cfg);
  assert.deepEqual(plan.agentPanes.map((p) => p.agentId), ["lead", "writer", "reviewer"]);
  assert.deepEqual(plan.agentPanes.map((p) => p.cli), ["claude", "claude", "codex"]);
  assert.equal(plan.session, "agent-bootstrap");
});

test("the three agents carry the expected roles/clis", () => {
  const byId = new Map(loadConfig(META).agents.map((a) => [a.id, a]));
  assert.equal(byId.get("lead")!.role, "lead");
  assert.equal(byId.get("lead")!.cli, "claude");
  assert.equal(byId.get("writer")!.role, "writer");
  assert.equal(byId.get("writer")!.cli, "claude");
  assert.equal(byId.get("reviewer")!.role, "reviewer");
  assert.equal(byId.get("reviewer")!.cli, "codex");
});
