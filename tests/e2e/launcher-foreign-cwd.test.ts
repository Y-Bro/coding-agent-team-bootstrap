import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";

// The real bash launcher (not team.ts) — this is what users invoke.
const LAUNCHER = join(process.cwd(), "bin", "team");

test("the launcher boots from a foreign cwd with no local node_modules (run-from-anywhere)", () => {
  // A fresh dir well outside the framework clone: it has no node_modules, so a
  // bare `tsx` specifier resolved from here would throw ERR_MODULE_NOT_FOUND.
  const foreign = mkdtempSync(join(tmpdir(), "team-foreign-"));
  assert.ok(!existsSync(join(foreign, "node_modules")), "fixture must have no node_modules");

  const res = spawnSync(LAUNCHER, ["doctor"], { cwd: foreign, encoding: "utf8", timeout: 30_000 });

  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.doesNotMatch(out, /ERR_MODULE_NOT_FOUND/, `launcher failed to resolve tsx from a foreign cwd:\n${out}`);
  assert.doesNotMatch(out, /Cannot find package 'tsx'/, out);
  // doctor runs to completion (0 = all tools present, 1 = some missing); a module
  // resolution crash would surface as null/non-0/1.
  assert.ok(res.status === 0 || res.status === 1, `doctor should run; status=${res.status}, out:\n${out}`);
});
