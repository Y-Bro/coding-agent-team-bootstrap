import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config/index.ts";

// Run the CLI entrypoint exactly the way a user (or the bin wrapper) does.
function runTeam(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "bin/team.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("`node --import tsx bin/team.ts doctor` launches (no shebang parse error) and exits 0", () => {
  const r = runTeam(["doctor"]);
  assert.doesNotMatch(r.stderr, /Parse error/, "the shebang must not break tsx parsing");
  assert.equal(r.status, 0, `doctor should exit 0; stderr: ${r.stderr}`);
});

test("`team init --yes --out <tmp>` writes a schema-valid team.yaml", () => {
  const dir = mkdtempSync(join(tmpdir(), "team-cli-"));
  const out = join(dir, "team.yaml");
  try {
    const r = runTeam(["init", "--yes", "--out", out]);
    assert.doesNotMatch(r.stderr, /Parse error/);
    assert.equal(r.status, 0, `init should exit 0; stderr: ${r.stderr}`);
    // The written config must load + validate through the m1 schema.
    const cfg = loadConfig(out);
    assert.ok(cfg.name.length > 0);
    assert.ok(cfg.agents.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
