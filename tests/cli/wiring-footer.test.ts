import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWiringFooter } from "../../src/cli/context-scaffolder.ts";

const agents = [
  { id: "lead", role: "lead", engine: "claude", subscribes: ["escalation"] },
  { id: "writer", role: "writer", engine: "claude", subscribes: ["review_comment", "ruling"] },
  { id: "reviewer", role: "reviewer", engine: "codex", subscribes: ["review_request"] },
];

test("footer names the agent, teammates, subscriptions, and broker commands", () => {
  const footer = buildWiringFooter("my-team", agents[1]!, agents);
  assert.match(footer, /writer/);
  assert.match(footer, /role: writer/);
  assert.match(footer, /lead \(lead\)/);
  assert.match(footer, /reviewer \(reviewer\)/);
  assert.match(footer, /review_comment, ruling/);
  assert.match(footer, /team inbox writer/);
  assert.match(footer, /team send --to/);
});
