import { test } from "node:test";
import assert from "node:assert/strict";
import type { GuidanceGenerator, GuidanceRequest } from "../../src/ports/guidance.ts";

test("a GuidanceGenerator returns string or null", async () => {
  const ok: GuidanceGenerator = { async generate(_r: GuidanceRequest) { return "text"; } };
  const none: GuidanceGenerator = { async generate(_r: GuidanceRequest) { return null; } };
  assert.equal(await ok.generate({ role: "writer", id: "a", team: "t", engine: "claude" }), "text");
  assert.equal(await none.generate({ role: "writer", id: "a", team: "t", engine: "claude" }), null);
});
