import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGINE_KINDS, isEngineKind } from "../../src/engines/profile.ts";
import type { EngineProfile, EngineKind } from "../../src/engines/profile.ts";

test("ENGINE_KINDS lists the built-in engines", () => {
  assert.deepEqual([...ENGINE_KINDS], ["claude", "codex"]);
});

test("isEngineKind narrows known engine identifiers", () => {
  assert.equal(isEngineKind("claude"), true);
  assert.equal(isEngineKind("codex"), true);
  assert.equal(isEngineKind("gemini"), false);
  assert.equal(isEngineKind(42), false);
});

test("EngineProfile describes how to launch, detect, and seed a CLI engine", () => {
  const kind: EngineKind = "claude";
  const profile: EngineProfile = {
    kind,
    displayName: "Claude Code",
    command: "claude",
    bin: "claude",
    roleFile: "CLAUDE.md",
  };
  assert.equal(profile.kind, "claude");
  assert.equal(profile.bin, "claude");
  assert.equal(profile.roleFile, "CLAUDE.md");
});
