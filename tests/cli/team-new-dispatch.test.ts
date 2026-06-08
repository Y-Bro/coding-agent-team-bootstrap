import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The real bash launcher (not `node --import tsx team.ts`, which can't resolve a
// bare `tsx` specifier from a foreign cwd) — this is what users actually invoke.
const LAUNCHER = join(process.cwd(), "bin", "team");

test("`team new --yes` scaffolds a team.yaml in the cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "teamnew-"));
  const res = spawnSync(LAUNCHER, ["new", "--yes", "--no-guidance"], {
    cwd: dir, encoding: "utf8", env: process.env, timeout: 30_000,
  });
  assert.equal(res.status, 0, `${res.stdout ?? ""}${res.stderr ?? ""}`);
  assert.ok(existsSync(join(dir, "team.yaml")));
});
