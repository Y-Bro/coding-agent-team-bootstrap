import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import type { AgentCard } from "../../src/a2a/index.ts";

const card = (over: Partial<AgentCard>): AgentCard => ({
  id: "x", role: "writer", cli: "claude", capabilities: [], skills: [],
  workdir: ".", subscribes: [], ...over,
});

function fixture(): Router {
  const reg = new AgentRegistry();
  reg.register(card({ id: "fe-writer", role: "writer", capabilities: ["frontend"], subscribes: ["ruling"] }));
  reg.register(card({ id: "fe-reviewer", role: "reviewer", subscribes: ["review_request"] }));
  reg.register(card({ id: "lead", role: "lead" }));
  return new Router(reg);
}

test("routes to a direct agent id", () => {
  assert.deepEqual(fixture().resolve("fe-writer", "note"), ["fe-writer"]);
});

test("routes by role (fan-out)", () => {
  assert.deepEqual(fixture().resolve("reviewer", "review_request").sort(), ["fe-reviewer"]);
});

test("routes by capability", () => {
  assert.deepEqual(fixture().resolve("frontend", "note"), ["fe-writer"]);
});

test("includes subscribers of the message type", () => {
  assert.ok(fixture().resolve("reviewer", "review_request").includes("fe-reviewer"));
});

test("throws on unknown target", () => {
  assert.throws(() => fixture().resolve("nobody", "note"), /unknown target/i);
});
