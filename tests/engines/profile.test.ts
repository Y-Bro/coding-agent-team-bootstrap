import { test } from "node:test";
import assert from "node:assert/strict";
import type { EngineProfile, EngineKind } from "../../src/engines/profile.ts";

test("EngineProfile describes the command, interaction kind, and role file", () => {
  const kind: EngineKind = "repl";
  const profile: EngineProfile = { command: "claude", kind, roleFile: "CLAUDE.md" };
  assert.equal(profile.command, "claude");
  assert.equal(profile.kind, "repl");
  assert.equal(profile.roleFile, "CLAUDE.md");
});
