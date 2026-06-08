import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutPlanner, LAYOUTS } from "../../src/cli/layout-planner.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";

const agents = [
  { id: "lead", role: "lead", engine: "claude" },
  { id: "writer", role: "writer", engine: "claude" },
  { id: "reviewer", role: "reviewer", engine: "codex" },
];

test("window defaults to agent id when answer is blank-equivalent; shared window asks layout", async () => {
  // answers: window(lead)=lead, window(writer)=build, window(reviewer)=build, layout(build)=even-horizontal
  const p = new ScriptedPrompter(["lead", "build", "build", "even-horizontal"]);
  const plan = await new LayoutPlanner(p).plan(agents);
  assert.deepEqual(plan.windowByAgent, { lead: "lead", writer: "build", reviewer: "build" });
  assert.deepEqual(plan.layoutByWindow, { build: "even-horizontal" });
});

test("solo windows are not asked for a layout", async () => {
  // each agent its own window; no layout questions consumed
  const p = new ScriptedPrompter(["lead", "writer", "reviewer"]);
  const plan = await new LayoutPlanner(p).plan(agents);
  assert.deepEqual(plan.layoutByWindow, {});
});

test("LAYOUTS lists the four tmux layouts", () => {
  assert.deepEqual(LAYOUTS, ["even-horizontal", "even-vertical", "tiled", "main-vertical"]);
});
