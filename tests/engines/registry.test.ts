// tests/engines/registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_ENGINES, resolveEngines } from "../../src/engines/index.ts";

test("ships the six built-in engines with role-file conventions", () => {
  const byName = Object.fromEntries(BUILTIN_ENGINES.map((e) => [e.name, e]));
  assert.equal(byName.claude.roleFile, "CLAUDE.md");
  assert.equal(byName.codex.roleFile, "AGENTS.md");
  for (const n of ["cursor-agent", "opencode", "gemini", "aider"]) {
    assert.ok(byName[n], `missing built-in ${n}`);
  }
});

test("resolveEngines merges custom engines, config wins on name collision", () => {
  const reg = resolveEngines({
    engines: {
      claude: { command: "claude", roleFile: "CUSTOM.md" }, // override
      mytool: { command: "mytool", roleFile: "MY.md" },     // new
    },
  });
  assert.equal(reg.get("claude")?.roleFile, "CUSTOM.md");
  assert.equal(reg.get("mytool")?.command, "mytool");
  assert.equal(reg.get("codex")?.roleFile, "AGENTS.md");   // built-in retained
});

test("resolveEngines with no config returns built-ins", () => {
  const reg = resolveEngines({});
  assert.equal(reg.get("claude")?.command, "claude");
  assert.equal(reg.get("nope"), undefined);
});
