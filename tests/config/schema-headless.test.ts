import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamConfigSchema } from "../../src/config/schema.ts";

test("a config-defined engine accepts headlessArgs", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    agents: [{ id: "a", role: "writer", cli: "mine" }],
    engines: { mine: { command: "mycli", roleFile: "MINE.md", headlessArgs: ["run"] } },
  });
  assert.deepEqual(cfg.engines!.mine!.headlessArgs, ["run"]);
});

test("headlessArgs is optional on engine profiles", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    agents: [{ id: "a", role: "writer", cli: "mine" }],
    engines: { mine: { command: "mycli", roleFile: "MINE.md" } },
  });
  assert.equal(cfg.engines!.mine!.headlessArgs, undefined);
});
