import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const TSX = import.meta.resolve("tsx");
const TEAM = join(REPO, "bin/team.ts");

// Plain workdirs, NO worktrees → no git needed.
const TEAM_YAML = `name: nogit
root: .
runtime: panes
broker: { transport: unix, socket: .team/broker.sock }
engines:
  noop: { command: sleep, args: ["600"], roleFile: AGENTS.md }
agents:
  - { id: alpha, role: writer, engine: noop }
  - { id: beta, role: reviewer, engine: noop }
`;

function runVerb(dir: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", TSX, TEAM, ...args], { cwd: dir, encoding: "utf8" });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("team up succeeds in a fresh NON-git dir when no worktrees are declared", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "team-nogit-"));
  writeFileSync(join(dir, "team.yaml"), TEAM_YAML);
  // deliberately NO `git init` — this is the crash repro

  const up = spawn(process.execPath, ["--import", TSX, TEAM, "up"], {
    cwd: dir, env: { ...process.env, TEAM_CONFIG: "team.yaml" },
  });
  let upErr = "";
  up.stderr.on("data", (c) => { upErr += c.toString(); });
  let exited: number | null = null;
  up.on("exit", (code) => { exited = code ?? 0; });

  const sock = join(dir, ".team", "broker.sock");
  try {
    for (let i = 0; i < 30 && !existsSync(sock) && exited === null; i++) await sleep(100);
    if (exited !== null && /tmux|ENOENT|spawn/.test(upErr)) { t.skip(`tmux unavailable: ${upErr.trim()}`); return; }
    assert.doesNotMatch(upErr, /not a git repository/, `must not crash on git in a non-git dir:\n${upErr}`);
    assert.ok(existsSync(sock), `broker socket should come up; stderr: ${upErr}`);

    const ps = runVerb(dir, ["ps"]);
    assert.match(ps.stdout, /alpha/);
    assert.match(ps.stdout, /beta/);
  } finally {
    up.kill("SIGKILL");
    spawnSync("tmux", ["kill-session", "-t", "nogit"]);
  }
});
