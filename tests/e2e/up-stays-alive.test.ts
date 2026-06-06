import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
// Resolve tsx to an absolute URL so the child finds it even with cwd in a temp dir.
const TSX = import.meta.resolve("tsx");

// A minimal team.yaml whose agent launches a harmless long-lived no-op, so
// `team up` bootstraps without needing a real CLI engine installed.
const TEAM_YAML = `name: smoke
root: .
runtime: panes
broker: { transport: unix, socket: .team/broker.sock }
engines:
  noop: { command: sleep, args: ["5"], roleFile: AGENTS.md }
agents:
  - { id: a, role: writer, engine: noop }
`;

test("`team up` stays alive (no commander fall-through killing the broker)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "team-up-"));
  writeFileSync(join(dir, "team.yaml"), TEAM_YAML);
  spawnSync("git", ["init", "-q"], { cwd: dir }); // bootstrapper probes `git worktree list`

  const child = spawn(process.execPath, ["--import", TSX, join(REPO, "bin/team.ts"), "up"], {
    cwd: dir,
    env: { ...process.env, TEAM_CONFIG: "team.yaml" },
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  let exitedEarly: number | null = null;
  child.on("exit", (code) => { exitedEarly = code ?? 0; });

  try {
    // Give it time to bootstrap and (in the bug) fall through to commander.
    await new Promise((r) => setTimeout(r, 2000));

    if (exitedEarly !== null && /tmux|ENOENT|spawn/.test(stderr)) {
      t.skip(`tmux unavailable in this environment: ${stderr.trim()}`);
      return;
    }
    assert.doesNotMatch(stderr, /unknown command/i, "must not hit commander for `up`");
    assert.equal(exitedEarly, null, "broker stayed alive (process did not exit)");
  } finally {
    child.kill("SIGKILL");
    spawnSync("tmux", ["kill-session", "-t", "smoke"]); // best-effort: drop the spawned session
  }
});
