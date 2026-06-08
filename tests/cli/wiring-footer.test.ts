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

const all = [
  { id: "boss", role: "orchestrator", engine: "claude", subscribes: ["task_assignment", "status", "escalation", "note", "review_request", "review_comment", "approval", "ruling"] },
  { id: "a1", role: "engineer", engine: "claude", subscribes: [] },
];

test("comms block documents commands, message types, topology, and examples", () => {
  // orchestrator (hub): hears everything; can address anyone
  const boss = buildWiringFooter("t", all[0]!, all);
  assert.match(boss, /## How to communicate/);
  assert.match(boss, /team inbox boss/);          // read mail
  assert.match(boss, /team send --to .* --type .* --text/); // send
  assert.match(boss, /task_assignment/);          // type vocabulary present
  assert.match(boss, /orchestrator|hub|address any/i);      // topology: hub can reach anyone

  // spoke: reaches the orchestrator
  const a1 = buildWiringFooter("t", all[1]!, all);
  assert.match(a1, /## How to communicate/);
  assert.match(a1, /team send --to boss/);        // spoke -> orchestrator by id
  assert.match(a1, /through the orchestrator|to the orchestrator|boss/i);
});
