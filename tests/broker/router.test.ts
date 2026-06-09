import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import type { AgentCard } from "../../src/a2a/index.ts";

const card = (over: Partial<AgentCard>): AgentCard => ({
  id: "x", role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [],
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

test("a NON-id (role) target broadcasts to type-subscribers too", () => {
  // 'reviewer' is a role (not an agent id): fe-reviewer matches the role, and
  // fe-writer is pulled in as a 'ruling' subscriber (broadcast-by-type).
  assert.deepEqual(fixture().resolve("reviewer", "ruling").sort(), ["fe-reviewer", "fe-writer"]);
});

test("a direct agent-id target does NOT fan out to type-subscribers (M3 direct send)", () => {
  // fe-reviewer is an exact agent id, so a 'ruling' send addressed to it goes
  // ONLY to fe-reviewer — even though fe-writer subscribes to 'ruling'.
  assert.deepEqual(fixture().resolve("fe-reviewer", "ruling"), ["fe-reviewer"]);
});

test("delivers to a pure subscriber with no other 'to' match", () => {
  // fe-reviewer subscribes to 'review_request'; 'review_request' is not an
  // id/role/capability, so only the subscription can route it.
  assert.deepEqual(fixture().resolve("review_request", "review_request"), ["fe-reviewer"]);
});

test("throws on unknown target", () => {
  assert.throws(() => fixture().resolve("nobody", "note"), /unknown target/i);
});
