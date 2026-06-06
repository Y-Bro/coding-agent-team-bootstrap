// tests/bootstrap/doctor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctor } from "../../src/bootstrap/doctor.ts";
import { FakeWhich } from "../../src/ports/which.ts";

test("blocks when a core tool is missing", async () => {
  const which = new FakeWhich(new Set(["git", "node"])); // tmux missing
  const report = await runDoctor({ which, engines: [] });
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((b) => b.includes("tmux")));
});

test("passes core, warns on missing selected engine treated as availability list", async () => {
  const which = new FakeWhich(new Set(["git", "node", "tmux", "claude"]));
  const report = await runDoctor({ which, engines: ["claude", "codex"] });
  assert.equal(report.ok, true);                                  // core present
  assert.deepEqual(report.enginesPresent, { claude: true, codex: false });
});
