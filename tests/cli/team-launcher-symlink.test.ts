import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The real bash launcher in the clone.
const LAUNCHER = join(process.cwd(), "bin", "team");

test("the launcher resolves its own symlink so tsx is found when invoked via a `npm link` symlink", () => {
  // Simulate `npm link`: a symlink to bin/team living in a *different* directory
  // (like nvm's global bin dir) whose `../node_modules/.bin/tsx` does NOT exist.
  const linkDir = mkdtempSync(join(tmpdir(), "team-link-"));
  const link = join(linkDir, "team");
  symlinkSync(LAUNCHER, link);

  // Verify the symlink chain points back at the clone's bin/team.
  assert.ok(lstatSync(link).isSymbolicLink(), "fixture must be a symlink");
  assert.equal(readlinkSync(link), LAUNCHER);

  // Invoke the SYMLINK from yet another cwd (run-from-anywhere). With an
  // unresolved DIR the launcher would exec `<linkDir>/../node_modules/.bin/tsx`,
  // which is missing -> exec fails with "No such file or directory".
  const foreign = mkdtempSync(join(tmpdir(), "team-cwd-"));
  const res = spawnSync(link, ["doctor"], { cwd: foreign, encoding: "utf8", timeout: 30_000 });

  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  assert.doesNotMatch(out, /No such file or directory/, `launcher failed to resolve its symlink:\n${out}`);
  assert.doesNotMatch(out, /Cannot find package 'tsx'/, out);
  assert.doesNotMatch(out, /ERR_MODULE_NOT_FOUND/, out);
  // doctor runs to completion: 0 = all tools present, 1 = some missing. A failed
  // exec would surface as null (spawn error) or 127, not 0/1.
  assert.ok(res.status === 0 || res.status === 1, `doctor should run; status=${res.status}, out:\n${out}`);
});
