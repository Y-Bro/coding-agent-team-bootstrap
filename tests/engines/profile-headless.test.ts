import { test } from "node:test";
import assert from "node:assert/strict";
import type { EngineProfile } from "../../src/engines/profile.ts";

test("EngineProfile accepts an optional headlessArgs array", () => {
  const p: EngineProfile = {
    name: "x", command: "x", roleFile: "X.md", headlessArgs: ["-p"],
  };
  assert.deepEqual(p.headlessArgs, ["-p"]);
});

test("headlessArgs is optional", () => {
  const p: EngineProfile = { name: "y", command: "y", roleFile: "Y.md" };
  assert.equal(p.headlessArgs, undefined);
});
